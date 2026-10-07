import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Loads the BUILT extension bundle with a stubbed `vscode` module.
 *
 * This is deliberately the bundle and not the source: it catches the class of
 * failure that type-checking cannot — a bad esbuild config, a missing
 * external, a top-level side effect that throws on load, a command declared in
 * package.json but never registered.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const bundle = path.join(root, 'dist/extension.js');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

interface Stub {
  registered: string[];
  contextKeys: Record<string, unknown>;
  subscriptions: { dispose(): void }[];
}

let stub: Stub;
let api: { activate(ctx: unknown): void; deactivate(): void };

function makeVscodeStub(s: Stub) {
  const disposable = { dispose() {} };
  const emitter = () => () => disposable;
  return {
    commands: {
      registerCommand(id: string) {
        s.registered.push(id);
        return disposable;
      },
      executeCommand(cmd: string, key?: string, value?: unknown) {
        if (cmd === 'setContext' && key) s.contextKeys[key] = value;
        return Promise.resolve();
      }
    },
    window: {
      createStatusBarItem: () => ({ show() {}, dispose() {}, text: '', tooltip: '', command: '' }),
      createWebviewPanel: () => {
        throw new Error('no panel should be created during activation without a board');
      },
      registerWebviewPanelSerializer: () => disposable,
      showInformationMessage: () => Promise.resolve(undefined),
      showWarningMessage: () => Promise.resolve(undefined),
      setStatusBarMessage: () => disposable,
      onDidChangeActiveColorTheme: emitter(),
      activeColorTheme: { kind: 2 }
    },
    workspace: {
      workspaceFolders: undefined,
      isTrusted: true,
      getConfiguration: () => ({ get: (_k: string, d?: unknown) => d, update: () => Promise.resolve() }),
      onDidChangeConfiguration: emitter(),
      onDidGrantWorkspaceTrust: emitter(),
      createFileSystemWatcher: () => ({
        onDidChange: emitter(),
        onDidCreate: emitter(),
        onDidDelete: emitter(),
        dispose() {}
      })
    },
    env: { clipboard: { writeText: () => Promise.resolve() } },
    Uri: { file: (p: string) => ({ fsPath: p }), joinPath: (b: { fsPath: string }, ...r: string[]) => ({ fsPath: path.join(b.fsPath, ...r) }) },
    RelativePattern: class {},
    ViewColumn: { Beside: 2 },
    StatusBarAlignment: { Right: 2 },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    ConfigurationTarget: { Global: 1 }
  };
}

beforeAll(() => {
  expect(fs.existsSync(bundle), 'dist/extension.js — run `npm run compile` first').toBe(true);

  stub = { registered: [], contextKeys: {}, subscriptions: [] };
  const vscodeStub = makeVscodeStub(stub);

  // Intercept `require('vscode')`, which esbuild leaves external.
  const req = Module.prototype.require as unknown as (id: string) => unknown;
  const patched = function (this: unknown, id: string) {
    if (id === 'vscode') return vscodeStub;
    return req.call(this, id);
  };
  (Module.prototype as unknown as { require: unknown }).require = patched;

  const m = new Module(bundle, undefined) as unknown as {
    _compile(code: string, filename: string): void;
    exports: typeof api;
  };
  (m as unknown as { paths: string[] }).paths = (Module as unknown as { _nodeModulePaths(d: string): string[] })._nodeModulePaths(
    path.dirname(bundle)
  );
  m._compile(fs.readFileSync(bundle, 'utf8'), bundle);
  api = m.exports;
});

describe('the built bundle', () => {
  it('exports activate and deactivate', () => {
    expect(typeof api.activate).toBe('function');
    expect(typeof api.deactivate).toBe('function');
  });

  it('activates without throwing when no folder is open', () => {
    expect(() =>
      api.activate({ subscriptions: stub.subscriptions, extensionUri: { fsPath: root }, workspaceState: { update: () => Promise.resolve() } })
    ).not.toThrow();
  });

  it('registers every command declared in package.json', () => {
    const declared: string[] = manifest.contributes.commands.map((c: { command: string }) => c.command);
    const missing = declared.filter((c) => !stub.registered.includes(c));
    expect(missing, `declared but never registered: ${missing.join(', ')}`).toEqual([]);
  });

  it('declares every command it registers', () => {
    const declared: string[] = manifest.contributes.commands.map((c: { command: string }) => c.command);
    const undeclared = stub.registered.filter((c) => !declared.includes(c));
    expect(undeclared, `registered but not in package.json: ${undeclared.join(', ')}`).toEqual([]);
  });

  it('sets the panelVisible context key false at activation', () => {
    expect(stub.contextKeys['agentBoard.panelVisible']).toBe(false);
  });

  it('deactivates without throwing', () => {
    expect(() => api.deactivate()).not.toThrow();
  });
});

describe('manifest invariants', () => {
  it('main points at a file that exists in the build', () => {
    expect(fs.existsSync(path.join(root, manifest.main))).toBe(true);
  });

  it('@types/vscode does not exceed engines.vscode (vsce hard-fails otherwise)', () => {
    const eng = manifest.engines.vscode.replace(/^[^\d]*/, '').split('.').map(Number);
    const typ = manifest.devDependencies['@types/vscode'].replace(/^[^\d]*/, '').split('.').map(Number);
    expect(typ[0] < eng[0] || (typ[0] === eng[0] && typ[1] <= eng[1])).toBe(true);
  });

  it('engines.vscode uses a range vsce accepts', () => {
    expect(manifest.engines.vscode).toMatch(/^(\*|[\^>]=?|\d)/);
    expect(manifest.engines.vscode.startsWith('~')).toBe(false);
  });

  it('does not combine .vscodeignore with a files array', () => {
    expect(fs.existsSync(path.join(root, '.vscodeignore'))).toBe(true);
    expect(manifest.files).toBeUndefined();
  });
});
