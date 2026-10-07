import * as fs from 'node:fs';
import * as vscode from 'vscode';

import type { RenderStyle, ThemeKind } from '../shared/types.js';
import { isMessage, type WebviewToHost } from '../shared/protocol.js';
import { BoardStore } from './boardStore.js';
import { NotesPanel, VIEW_TYPE } from './panel.js';
import { listLibrary, resolveInLibrary } from './library.js';
import {
  appendFeedback,
  clearFeedback,
  deleteMark,
  recordMove,
  updateMark,
  corruptReason,
  FeedbackCorruptError,
  readFeedbackSafe
} from './feedback.js';
import { handOff, notifyCaptured } from './notify.js';
import { isWritable, notesPath, watchedFolderName, workspaceRoot } from './workspace.js';

let panel: NotesPanel | null = null;
let store: BoardStore | null = null;
let watcher: vscode.FileSystemWatcher | null = null;
let ctx: vscode.ExtensionContext;

function forceReducedMotion(): boolean {
  return vscode.workspace.getConfiguration('agentBoard').get<string>('reducedMotion', 'auto') === 'always';
}

function themeKind(): ThemeKind {
  switch (vscode.window.activeColorTheme.kind) {
    case vscode.ColorThemeKind.Light:
      return 'light';
    case vscode.ColorThemeKind.HighContrast:
      return 'high-contrast-dark';
    case vscode.ColorThemeKind.HighContrastLight:
      return 'high-contrast-light';
    default:
      return 'dark';
  }
}

function setPanelVisibleContext(v: boolean): void {
  void vscode.commands.executeCommand('setContext', 'agentBoard.panelVisible', v);
}

function openPanel(): void {
  if (panel) {
    panel.reveal();
    return;
  }
  if (!workspaceRoot()) {
    void vscode.window.showInformationMessage(
      'Agent Board: open a folder first — the panel renders .agent/notes.json from the workspace root.'
    );
    return;
  }
  attach(NotesPanel.create(ctx.extensionUri));
}

function attach(p: NotesPanel): void {
  panel = p;
  store = new BoardStore(p);
  setPanelVisibleContext(true);

  p.onDidDispose(() => {
    panel = null;
    store = null;
    setPanelVisibleContext(false);
    watcher?.dispose();
    watcher = null;
  });

  p.onDidReceiveMessage((raw) => void onMessage(raw));

  const root = workspaceRoot();
  if (!root) return;

  watcher?.dispose();
  watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '.agent/notes.json'));
  const onChange = () => void store?.onFileChanged();
  watcher.onDidChange(onChange);
  watcher.onDidCreate(onChange);
  ctx.subscriptions.push(watcher);

  // Create the file so the watcher has something to watch, but only if we may
  // write. Never clobber an existing board.
  const np = notesPath();
  if (np && isWritable()) {
    try {
      if (!fs.existsSync(np)) fs.writeFileSync(np, '');
    } catch {
      /* read-only workspace; the panel still renders whatever is there */
    }
  }
}

async function onMessage(raw: unknown): Promise<void> {
  if (!isMessage(raw) || !panel || !store) return;
  const msg = raw as WebviewToHost;

  switch (msg.type) {
    case 'ready': {
      panel.post({ type: 'themeChanged', kind: themeKind(), forceReducedMotion: forceReducedMotion() });
      const style = vscode.workspace.getConfiguration('agentBoard').get<RenderStyle>('defaultStyle');
      if (style) panel.post({ type: 'setStyle', style });
      await store.render();
      panel.post({ type: 'feedbackState', data: readFeedbackSafe() });
      panel.post({ type: 'library', items: listLibrary() });
      if (corruptReason()) {
        panel.post({
          type: 'error',
          message: `The feedback log (.agent/notes_feedback.json) could not be read: ${corruptReason()}. It has been left untouched so nothing is lost — fix or delete it, then run "Agent Board: Clear Marks".`
        });
      }
      return;
    }

    case 'feedback': {
      try {
        const log = appendFeedback(msg.kind, msg.payload, store.liveSpec?.title);
        panel.post({ type: 'feedbackState', data: log });
        void notifyCaptured(msg.kind, msg.payload);
      } catch (e) {
        const detail =
          e instanceof FeedbackCorruptError
            ? `${e.message} The file has been left untouched so nothing is lost.`
            : (e as Error).message;
        panel.post({ type: 'error', message: `Could not save your reply. ${detail}` });
      }
      return;
    }

    case 'clearFeedback':
      panel.post({ type: 'feedbackState', data: clearFeedback() });
      return;

    case 'updateMark':
      try {
        panel.post({ type: 'feedbackState', data: updateMark(msg.id, msg.patch) });
      } catch (e) {
        panel.post({ type: 'error', message: `Could not save that change. ${(e as Error).message}` });
      }
      return;

    case 'moveElement':
      try {
        panel.post({ type: 'feedbackState', data: recordMove(msg.targetId, msg.dx, msg.dy, store.liveSpec?.title) });
      } catch (e) {
        panel.post({ type: 'error', message: `Could not save that move. ${(e as Error).message}` });
      }
      return;

    case 'deleteMark':
      try {
        panel.post({ type: 'feedbackState', data: deleteMark(msg.id) });
      } catch (e) {
        panel.post({ type: 'error', message: `Could not delete that. ${(e as Error).message}` });
      }
      return;

    case 'listLibrary':
      panel.post({ type: 'library', items: listLibrary() });
      return;

    case 'saveBoard': {
      const name = store.saveCurrent();
      panel.post({ type: 'library', items: listLibrary() });
      vscode.window.setStatusBarMessage(
        name ? `$(notebook) Agent Board: saved to .agent/notes/${name}` : '$(warning) Agent Board: nothing to save yet',
        4000
      );
      return;
    }

    case 'loadFromLibrary':
      if (!store.showSaved(msg.file)) reject(msg.file);
      return;

    case 'resumeLive':
      if (!(await store.resume(msg.file))) reject(msg.file);
      return;

    case 'backToLive':
      await store.backToLive();
      return;

    case 'copyMention': {
      // Validate even here: the value is interpolated into text the user will
      // paste, and it must name a real library file.
      if (!resolveInLibrary(msg.file)) {
        reject(msg.file);
        return;
      }
      const label = (msg.title ? msg.title + ' - ' : '') + '.agent/notes/' + msg.file;
      await vscode.env.clipboard.writeText(`Let's continue from the saved note ${label}.`);
      vscode.window.setStatusBarMessage('$(clippy) Agent Board: mention copied — paste it in chat', 4000);
      return;
    }

    case 'styleChanged':
      void ctx.workspaceState.update('agentBoard.style', msg.style);
      return;

    case 'announce':
      return; // handled entirely inside the webview's live region

    case 'description':
      await vscode.env.clipboard.writeText(msg.text);
      vscode.window.setStatusBarMessage('$(clippy) Agent Board: board copied as text', 4000);
      return;

    default:
      return; // unknown type: ignore (forward compatibility)
  }
}

function reject(file: unknown): void {
  // A filename that does not resolve inside the library is dropped whole,
  // never partially handled (FR-034, SC-009).
  console.warn('[agent-board] rejected library filename:', file);
  panel?.post({ type: 'error', message: 'That board could not be opened.' });
}

export function activate(context: vscode.ExtensionContext): void {
  ctx = context;
  setPanelVisibleContext(false);

  const reg = (id: string, fn: () => void | Promise<void>) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('agentBoard.open', openPanel);
  reg('agentBoard.clear', () => store?.clear());
  reg('agentBoard.clearFeedback', () => {
    const data = clearFeedback();
    panel?.post({ type: 'feedbackState', data });
  });
  reg('agentBoard.saveBoard', () => {
    const name = store?.saveCurrent();
    panel?.post({ type: 'library', items: listLibrary() });
    if (name) void vscode.window.showInformationMessage(`Agent Board: saved to .agent/notes/${name}`);
    else void vscode.window.showWarningMessage('Agent Board: nothing to save yet.');
  });
  reg('agentBoard.handOffFeedback', handOff);
  reg('agentBoard.openLibrary', () => {
    openPanel();
    panel?.post({ type: 'library', items: listLibrary() });
  });
  reg('agentBoard.fit', () => panel?.post({ type: 'viewport', action: 'fit' }));
  reg('agentBoard.resetZoom', () => panel?.post({ type: 'viewport', action: 'resetZoom' }));
  reg('agentBoard.copyDescription', () => panel?.post({ type: 'viewport', action: 'copyDescription' }));
  reg('agentBoard.setStyle', async () => {
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Sketchy', description: 'hand-drawn whiteboard', value: 'sketchy' as RenderStyle },
        { label: 'Clean', description: 'precise SVG, for sharing', value: 'clean' as RenderStyle },
        { label: 'Mermaid', description: 'formal graph types', value: 'mermaid' as RenderStyle }
      ],
      { placeHolder: 'Render style for the current board' }
    );
    if (pick) panel?.post({ type: 'setStyle', style: pick.value });
  });

  // Theme changes: the body class is observable in the webview, but only the
  // host can tell high-contrast light from high-contrast dark authoritatively.
  // The per-panel reduced-motion override is a setting, so react to it too.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agentBoard.reducedMotion')) {
        panel?.post({ type: 'themeChanged', kind: themeKind(), forceReducedMotion: forceReducedMotion() });
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() =>
      panel?.post({ type: 'themeChanged', kind: themeKind(), forceReducedMotion: forceReducedMotion() })
    )
  );

  // A webview panel belongs to one window, so a second window shows nothing
  // even though the spec is on disk. Auto-open there, opt-out by setting.
  if (vscode.workspace.getConfiguration('agentBoard').get<boolean>('openOnStartup', true)) {
    const np = notesPath();
    if (np) {
      try {
        if (fs.existsSync(np) && fs.readFileSync(np, 'utf8').trim()) openPanel();
      } catch {
        /* openPanel's own error path covers a bad file */
      }
    }
  }

  if (vscode.window.registerWebviewPanelSerializer) {
    context.subscriptions.push(
      vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
        deserializeWebviewPanel(restored) {
          attach(NotesPanel.revive(restored, context.extensionUri));
          return Promise.resolve();
        }
      })
    );
  }

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'agentBoard.open';
  const folder = watchedFolderName();
  status.text = '$(notebook) Notes';
  status.tooltip = folder
    ? `Open the Agent Board (ctrl+alt+n) — watching the "${folder}" folder`
    : 'Open the Agent Board (ctrl+alt+n)';
  status.show();
  context.subscriptions.push(status);
}

export function deactivate(): void {
  watcher?.dispose();
  watcher = null;
  panel?.dispose();
  panel = null;
}
