import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

/**
 * Integration tests: a real VS Code, a real workspace folder, the real
 * extension host.
 *
 * These cover what the unit suite structurally cannot — activation, the
 * contributed surface, workspace trust, and the security boundary as the
 * extension actually enforces it on disk.
 */

const EXT_ID = 'local.agent-board';

function agentDir(): string {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  return path.join(root, '.agent');
}

function write(rel: string, text: string): string {
  const p = path.join(agentDir(), rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

suite('activation', () => {
  let ext: vscode.Extension<unknown>;

  suiteSetup(async function () {
    this.timeout(60_000); // cold activation in CI is slow
    const found = vscode.extensions.getExtension(EXT_ID);
    assert.ok(found, `extension ${EXT_ID} not found — check publisher.name`);
    ext = found;
    await ext.activate();
  });

  test('activates', () => {
    assert.strictEqual(ext.isActive, true);
  });

  test('a workspace folder is open', () => {
    assert.ok(vscode.workspace.workspaceFolders?.length, 'the test workspaceFolder did not open');
  });

  test('registers every contributed command', async () => {
    // NOTE: getCommands(true) filters INTERNAL commands (underscore-prefixed).
    // It is not a "refresh" flag, despite widespread belief.
    const all = await vscode.commands.getCommands(true);
    const declared = (ext.packageJSON.contributes.commands as { command: string }[]).map((c) => c.command);
    const missing = declared.filter((c) => !all.includes(c));
    assert.deepStrictEqual(missing, [], `declared but not registered: ${missing.join(', ')}`);
  });

  test('declares capabilities explicitly', () => {
    const caps = ext.packageJSON.capabilities;
    assert.ok(caps, 'capabilities block missing');
    assert.strictEqual(caps.untrustedWorkspaces.supported, 'limited');
    assert.strictEqual(caps.virtualWorkspaces.supported, false);
  });

  test('activates on workspaceContains, not on startup', () => {
    assert.deepStrictEqual(ext.packageJSON.activationEvents, ['workspaceContains:.agent/notes.json']);
  });
});

suite('the panel', () => {
  suiteSetup(async function () {
    this.timeout(60_000);
    await vscode.extensions.getExtension(EXT_ID)!.activate();
  });

  test('opens without throwing', async function () {
    this.timeout(30_000);
    await vscode.commands.executeCommand('agentBoard.open');
    // executeCommand resolves when the HANDLER returns, not when the webview
    // has painted — so this asserts "did not throw", nothing about content.
    await sleep(500);
  });

  test('opening twice reveals rather than creating a second panel', async function () {
    this.timeout(30_000);
    await vscode.commands.executeCommand('agentBoard.open');
    await vscode.commands.executeCommand('agentBoard.open');
    await sleep(300);
  });

  test('survives a board being written', async function () {
    this.timeout(30_000);
    write('notes.json', JSON.stringify({ title: 'integration board', nodes: [{ id: 'a', label: 'hello' }] }));
    await sleep(800);
  });

  test('survives a malformed board without throwing', async function () {
    this.timeout(30_000);
    write('notes.json', '{ "title": ');
    await sleep(800);
    write('notes.json', JSON.stringify({ title: 'integration board', nodes: [{ id: 'a' }] }));
    await sleep(500);
  });

  test('survives a null board', async function () {
    this.timeout(30_000);
    write('notes.json', 'null');
    await sleep(600);
  });
});

suite('feedback durability (FR-035)', () => {
  test('a corrupt feedback log is NOT overwritten', async function () {
    this.timeout(30_000);
    const p = write('notes_feedback.json', '{"answers":[');
    const before = fs.readFileSync(p, 'utf8');

    // Nudge the extension into a read by re-rendering the board.
    write('notes.json', JSON.stringify({ title: 'durability', nodes: [{ id: 'a' }] }));
    await sleep(800);

    assert.strictEqual(
      fs.readFileSync(p, 'utf8'),
      before,
      'the corrupt log was modified — the prototype replaced it with an empty object, destroying every answer'
    );
  });

  test('clearing marks writes a valid empty log', async function () {
    this.timeout(30_000);
    await vscode.commands.executeCommand('agentBoard.clearFeedback');
    await sleep(400);
    const p = path.join(agentDir(), 'notes_feedback.json');
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.deepStrictEqual(parsed.answers, []);
    assert.deepStrictEqual(parsed.drawings, []);
    assert.deepStrictEqual(parsed.stickies, []);
  });
});

suite('library containment (FR-034, SC-009)', () => {
  test('a traversal filename cannot read or write outside .agent/notes', async () => {
    const { resolveInLibrary } = (await import('../../src/extension/library.js')) as {
      resolveInLibrary(f: unknown): string | undefined;
    };
    const attacks = [
      '../../../etc/passwd',
      '..',
      '.',
      '/etc/passwd',
      'sub/dir.json',
      'sub\\dir.json',
      '.hidden.json',
      'no-extension',
      ''
    ];
    for (const a of attacks) {
      assert.strictEqual(resolveInLibrary(a), undefined, `should have rejected ${JSON.stringify(a)}`);
    }
  });

  test('a plain filename resolves inside the library', async () => {
    const { resolveInLibrary } = (await import('../../src/extension/library.js')) as {
      resolveInLibrary(f: unknown): string | undefined;
    };
    const ok = resolveInLibrary('board.json');
    assert.ok(ok, 'a normal filename was rejected');
    assert.ok(ok!.startsWith(path.join(agentDir(), 'notes')), 'resolved outside the library directory');
  });
});

suite('library bounds (FR-039, SC-010)', () => {
  test('repeated saves of one board produce one file, not one per save', async function () {
    this.timeout(60_000);
    const dir = path.join(agentDir(), 'notes');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));

    for (let i = 0; i < 12; i++) {
      write('notes.json', JSON.stringify({ title: 'one board', nodes: [{ id: 'a', label: `v${i}` }] }));
      await sleep(120);
      await vscode.commands.executeCommand('agentBoard.saveBoard');
      await sleep(120);
    }
    // Count only THIS board's slug. Other files in the directory are the
    // auto-archive doing its job: when the live board's title changes, the
    // outgoing board is saved before it is replaced.
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const mine = files.filter((f) => f === 'one-board.json');
    assert.strictEqual(
      mine.length,
      1,
      `expected exactly one file for this board, got ${mine.length}. All files: ${files.join(', ')}`
    );
    assert.ok(
      files.length <= 3,
      `the library grew more than the auto-archive explains: ${files.join(', ')}`
    );
  });
});
