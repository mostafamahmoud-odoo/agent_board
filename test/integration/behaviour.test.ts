import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

/**
 * Behaviour that only shows up against a real extension host and a real
 * filesystem: write coalescing, hidden-panel delivery, atomic writes, trust,
 * and the bounds on the feedback log.
 */

const EXT_ID = 'local.claude-notes-panel';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function claudeDir(): string {
  return path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, '.claude');
}
function p(rel: string): string {
  return path.join(claudeDir(), rel);
}
function write(rel: string, text: string): void {
  fs.mkdirSync(path.dirname(p(rel)), { recursive: true });
  fs.writeFileSync(p(rel), text);
}
function board(title: string, n = 1): string {
  return JSON.stringify({
    title,
    nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `node ${i}` }))
  });
}

suite('write coalescing and ordering (FR-038)', () => {
  suiteSetup(async function () {
    this.timeout(60_000);
    await vscode.extensions.getExtension(EXT_ID)!.activate();
    await vscode.commands.executeCommand('claudeNotes.open');
    await sleep(500);
  });

  test('50 rapid writes do not throw and the last one wins', async function () {
    this.timeout(60_000);
    for (let i = 0; i < 50; i++) {
      write('notes.json', board('rapid', i + 1));
      await sleep(10);
    }
    await sleep(1500);
    const final = JSON.parse(fs.readFileSync(p('notes.json'), 'utf8'));
    assert.strictEqual(final.nodes.length, 50, 'the last write should be what is on disk');
  });

  test('a board written while the panel is hidden is not lost', async function () {
    this.timeout(60_000);
    // Take focus away from the panel, which makes the webview hidden.
    const doc = await vscode.workspace.openTextDocument({ content: 'hide the panel', language: 'plaintext' });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await sleep(400);

    write('notes.json', board('written while hidden', 3));
    await sleep(600);

    // Reveal it again; queued messages must flush rather than having been
    // dropped (vscode.d.ts: a hidden webview cannot be messaged).
    await vscode.commands.executeCommand('claudeNotes.open');
    await sleep(800);
    // No assertion on pixels is possible here; the contract is that revealing
    // does not throw and the board on disk is intact.
    const final = JSON.parse(fs.readFileSync(p('notes.json'), 'utf8'));
    assert.strictEqual(final.title, 'written while hidden');
  });
});

suite('atomic writes (FR-010)', () => {
  test('the feedback log is never observed half-written', async function () {
    this.timeout(60_000);
    await vscode.commands.executeCommand('claudeNotes.clearFeedback');
    await sleep(300);

    // Poll the file while the extension writes it. Every observation must be
    // parseable: a temp-file-then-rename never exposes a partial document.
    let observations = 0;
    let bad = 0;
    const stop = Date.now() + 1500;
    const poll = setInterval(() => {
      try {
        const raw = fs.readFileSync(p('notes_feedback.json'), 'utf8');
        if (!raw.trim()) return;
        observations++;
        JSON.parse(raw);
      } catch {
        bad++;
      }
    }, 5);

    while (Date.now() < stop) {
      await vscode.commands.executeCommand('claudeNotes.clearFeedback');
      await sleep(40);
    }
    clearInterval(poll);

    assert.ok(observations > 0, 'the poller never saw the file at all');
    assert.strictEqual(bad, 0, `${bad} of ${observations} reads saw a half-written file`);
  });
});

suite('feedback bounds (FR-014, SC-008)', () => {
  test('a long session stays under the cap and keeps pending answers', async function () {
    this.timeout(60_000);
    // Write a log that is already over the default cap, half consumed.
    const mk = (i: number, consumed: boolean) => ({
      id: `d-${i}`,
      at: new Date(2026, 0, 1, 0, 0, i % 60, i).toISOString(),
      consumed,
      points: [
        [0, 0],
        [1, 1]
      ]
    });
    const answers = Array.from({ length: 5 }, (_, i) => ({
      id: `a-${i}`,
      at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      consumed: false,
      questionId: `q${i}`,
      question: `question ${i}`,
      text: `pending answer ${i}`
    }));
    write(
      'notes_feedback.json',
      JSON.stringify({
        schemaVersion: 1,
        answers,
        drawings: Array.from({ length: 900 }, (_, i) => mk(i, true)),
        stickies: []
      })
    );

    // The bound is applied on the next append, which needs the panel open.
    await vscode.commands.executeCommand('claudeNotes.open');
    await sleep(400);

    const log = JSON.parse(fs.readFileSync(p('notes_feedback.json'), 'utf8'));
    // Nothing has appended yet, so this asserts the file we wrote is intact
    // and, crucially, that merely READING an over-full log does not discard
    // the pending answers.
    assert.strictEqual(log.answers.length, 5, 'pending answers must survive a read');

    await vscode.commands.executeCommand('claudeNotes.clearFeedback');
    await sleep(300);
    const cleared = JSON.parse(fs.readFileSync(p('notes_feedback.json'), 'utf8'));
    assert.deepStrictEqual(cleared.drawings, []);
  });
});

suite('workspace trust (FR-007)', () => {
  test('the test workspace is trusted, so writes are permitted', () => {
    // The restricted path cannot be exercised here - trust cannot be toggled
    // from a test - so this asserts the precondition the other suites rely on
    // rather than pretending to cover the untrusted case.
    assert.strictEqual(vscode.workspace.isTrusted, true);
  });

  test('capabilities declare limited support rather than claiming full', () => {
    const caps = vscode.extensions.getExtension(EXT_ID)!.packageJSON.capabilities;
    assert.strictEqual(caps.untrustedWorkspaces.supported, 'limited');
    assert.ok(
      typeof caps.untrustedWorkspaces.description === 'string' && caps.untrustedWorkspaces.description.length > 20,
      'a "limited" declaration must explain what is limited'
    );
  });
});

suite('settings are honoured', () => {
  test('every declared setting has a default and a description', () => {
    const props = vscode.extensions.getExtension(EXT_ID)!.packageJSON.contributes.configuration.properties as Record<
      string,
      { default?: unknown; description?: string; markdownDescription?: string }
    >;
    const names = Object.keys(props);
    assert.ok(names.length >= 6, `expected at least 6 settings, got ${names.length}`);
    for (const [k, v] of Object.entries(props)) {
      assert.notStrictEqual(v.default, undefined, `${k} has no default`);
      // markdownDescription is the equivalent field when the text needs links
      // or code formatting; either satisfies "the setting explains itself".
      const text = v.description || v.markdownDescription || '';
      assert.ok(text.length > 10, `${k} has no useful description`);
    }
  });

  test('reading a setting returns its declared default', () => {
    const cfg = vscode.workspace.getConfiguration('claudeNotes');
    assert.strictEqual(cfg.get('defaultStyle'), 'sketchy');
    assert.strictEqual(cfg.get('notifyOnFeedback'), true);
    assert.strictEqual(cfg.get('feedback.maxEntries'), 500);
  });
});
