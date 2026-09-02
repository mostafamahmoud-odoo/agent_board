const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

let panel = null;
let watcher = null;

function getNotesPath() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  const dir = path.join(folders[0].uri.fsPath, '.claude');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'notes.json');
}

function getFeedbackPath() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  const dir = path.join(folders[0].uri.fsPath, '.claude');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'notes_feedback.json');
}

const EMPTY_FEEDBACK = { answers: [], drawings: [], stickies: [] };

function readFeedback() {
  const p = getFeedbackPath();
  if (!p || !fs.existsSync(p)) return Object.assign({}, EMPTY_FEEDBACK);
  try {
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (!raw) return Object.assign({}, EMPTY_FEEDBACK);
    const data = JSON.parse(raw);
    return {
      answers: Array.isArray(data.answers) ? data.answers : [],
      drawings: Array.isArray(data.drawings) ? data.drawings : [],
      stickies: Array.isArray(data.stickies) ? data.stickies : []
    };
  } catch (e) {
    return Object.assign({}, EMPTY_FEEDBACK);
  }
}

function writeFeedback(data) {
  const p = getFeedbackPath();
  if (!p) return;
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// Appends one reply from the panel (an answered question, a pen stroke, or a
// sticky note) to notes_feedback.json. Claude has no live connection into the
// webview - this file is the only channel back, read whenever Claude is next
// invoked, so every entry must be self-contained and durable.
function appendFeedback(kind, payload) {
  const data = readFeedback();
  const bucket = kind === 'answer' ? 'answers' : kind === 'drawing' ? 'drawings' : kind === 'sticky' ? 'stickies' : null;
  if (!bucket) return;
  const id = kind[0] + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  data[bucket].push(Object.assign({ id, at: new Date().toISOString() }, payload || {}));
  writeFeedback(data);
  return data;
}

function sendFeedbackState() {
  if (!panel) return;
  panel.webview.postMessage({ type: 'feedbackState', data: readFeedback() });
}

// Persistent library: unlike notes.json (a scratch channel Claude overwrites
// on every update), .claude/notes/<slug>.json entries are kept - written on
// request and reloadable any time, in this session or a future one.
function getNotesDir() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  const dir = path.join(folders[0].uri.fsPath, '.claude', 'notes');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function slugify(title) {
  const base = String(title || 'note').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'note';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return base + '-' + stamp;
}

function listLibrary() {
  const dir = getNotesDir();
  if (!dir) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const full = path.join(dir, f);
      let title = f.replace(/\.json$/, '');
      try {
        const spec = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (spec && spec.title) title = spec.title;
      } catch (e) { /* fall back to the filename */ }
      const stat = fs.statSync(full);
      return { file: f, title: title, savedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

function sendLibrary() {
  if (!panel) return;
  panel.webview.postMessage({ type: 'library', items: listLibrary() });
}

function autoSaveSpec(spec) {
  const dir = getNotesDir();
  if (!dir || !spec) return null;
  const name = slugify(spec.title) + '.json';
  try {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(spec, null, 2));
    sendLibrary();
    return name;
  } catch (e) {
    return null;
  }
}

function saveCurrentBoard() {
  const notesPath = getNotesPath();
  if (!notesPath || !fs.existsSync(notesPath)) return null;
  const raw = fs.readFileSync(notesPath, 'utf8').trim();
  if (!raw) return null;
  let spec;
  try { spec = JSON.parse(raw); } catch (e) { return null; }
  return autoSaveSpec(spec);
}

// The last spec actually shown as the *live* board (not a saved snapshot
// being viewed) - kept so a title change can be recognised as "the old
// board is being replaced" and archived before it's gone for good.
let lastLiveSpec = null;

// While the panel is showing a saved snapshot instead of the live board, a
// write to notes.json must not yank the view out from under it - flag it
// instead and let the user choose when to switch.
let viewingSavedFile = null;

function readAndRender() {
  const notesPath = getNotesPath();
  if (!panel || !notesPath || !fs.existsSync(notesPath)) return;
  try {
    const raw = fs.readFileSync(notesPath, 'utf8').trim();
    if (!raw) return;
    const spec = JSON.parse(raw);
    // Auto-save: a title change means the previous board is being replaced
    // outright, not just grown incrementally - archive it instead of letting
    // it vanish silently the moment the new one lands.
    if (lastLiveSpec && lastLiveSpec.title && spec.title !== lastLiveSpec.title) {
      autoSaveSpec(lastLiveSpec);
    }
    lastLiveSpec = spec;
    panel.webview.postMessage({ type: 'render', spec });
  } catch (e) {
    panel.webview.postMessage({ type: 'error', message: String(e.message || e) });
  }
}

function buildHtml(context, webview) {
  const mediaDir = vscode.Uri.file(path.join(context.extensionPath, 'media'));
  const html = fs.readFileSync(path.join(mediaDir.fsPath, 'panel.html'), 'utf8');
  const uri = (...parts) =>
    webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, ...parts)).toString();
  return html
    .replace(/{{cspSource}}/g, webview.cspSource)
    .replace(/{{mermaidUri}}/g, uri('vendor', 'mermaid.min.js'))
    .replace(/{{roughUri}}/g, uri('vendor', 'rough.js'));
}

function attachPanel(context, p) {
  panel = p;
  viewingSavedFile = null;
  lastLiveSpec = null;
  panel.webview.html = buildHtml(context, panel.webview);

  panel.onDidDispose(() => {
    panel = null;
    if (watcher) { watcher.dispose(); watcher = null; }
  });

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage('Claude Notes: open a folder first.');
    return;
  }

  const notesPath = getNotesPath();
  if (!fs.existsSync(notesPath)) fs.writeFileSync(notesPath, '');

  // FileSystemWatcher survives atomic writes (write-to-temp + rename), which
  // fs.watch on a single file does not.
  if (watcher) { watcher.dispose(); watcher = null; }
  watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folders[0], '.claude/notes.json')
  );
  const onChange = () => setTimeout(() => {
    if (viewingSavedFile) { if (panel) panel.webview.postMessage({ type: 'liveUpdated' }); return; }
    readAndRender();
  }, 50);
  watcher.onDidChange(onChange);
  watcher.onDidCreate(onChange);
  context.subscriptions.push(watcher);

  // The authoritative first render: wait for the webview's own 'ready' post
  // instead of racing webview.html against this extension-host code. A
  // fallback timer covers a webview build old enough not to send it.
  let rendered = false;
  const renderOnce = () => { if (!rendered) { rendered = true; readAndRender(); sendFeedbackState(); sendLibrary(); } };
  context.subscriptions.push(
    panel.webview.onDidReceiveMessage((msg) => {
      if (!msg) return;
      if (msg.type === 'ready') { renderOnce(); return; }
      if (msg.type === 'feedback') {
        appendFeedback(msg.kind, msg.payload);
        // A toast is the only nudge available - there is no live channel into
        // whatever is currently running Claude, so surface it to the human
        // instead: tell them where the reply landed and that Claude needs a
        // fresh message to notice it.
        const preview = (msg.payload && msg.payload.text) ? ': "' + String(msg.payload.text).slice(0, 80) + '"' : '';
        vscode.window.setStatusBarMessage('$(notebook) Claude Notes: reply saved' + preview, 4000);
        return;
      }
      if (msg.type === 'clearFeedback') { writeFeedback(Object.assign({}, EMPTY_FEEDBACK)); return; }
      if (msg.type === 'listLibrary') { sendLibrary(); return; }
      if (msg.type === 'saveBoard') {
        const name = saveCurrentBoard();
        sendLibrary();
        vscode.window.setStatusBarMessage(name
          ? '$(notebook) Claude Notes: saved to .claude/notes/' + name
          : '$(warning) Claude Notes: nothing to save yet', 4000);
        return;
      }
      if (msg.type === 'loadFromLibrary') {
        const dir = getNotesDir();
        if (!dir || !msg.file) return;
        const full = path.join(dir, msg.file);
        if (!fs.existsSync(full)) return;
        try {
          const spec = JSON.parse(fs.readFileSync(full, 'utf8'));
          viewingSavedFile = msg.file;
          panel.webview.postMessage({ type: 'render', spec, viewingSaved: msg.file });
        } catch (e) {
          panel.webview.postMessage({ type: 'error', message: String(e.message || e) });
        }
        return;
      }
      if (msg.type === 'resumeLive') {
        const dir = getNotesDir();
        const notesPath = getNotesPath();
        if (!dir || !notesPath || !msg.file) return;
        const full = path.join(dir, msg.file);
        if (!fs.existsSync(full)) return;
        fs.copyFileSync(full, notesPath);
        viewingSavedFile = null;
        readAndRender();
        return;
      }
      if (msg.type === 'backToLive') { viewingSavedFile = null; readAndRender(); return; }
      if (msg.type === 'copyMention') {
        const label = (msg.title ? msg.title + ' - ' : '') + '.claude/notes/' + msg.file;
        vscode.env.clipboard.writeText("Let's continue from the saved note " + label + '.');
        vscode.window.setStatusBarMessage('$(clippy) Claude Notes: mention copied - paste it in chat', 4000);
        return;
      }
    })
  );
  setTimeout(renderOnce, 800);
}

function openPanel(context) {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside);
    return;
  }
  attachPanel(context, vscode.window.createWebviewPanel(
    'claudeNotes',
    'Claude Notes',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
    }
  ));
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeNotes.open', () => openPanel(context))
  );

  // A webview panel belongs to one VS Code window/process - opening a second
  // window never carries it over, even though the .claude/notes.json spec it
  // was drawn from is still sitting on disk. Auto-open here so a new window
  // shows the board immediately instead of needing the command/click/redraw.
  const notesPath = getNotesPath();
  if (notesPath && fs.existsSync(notesPath)) {
    try {
      if (fs.readFileSync(notesPath, 'utf8').trim()) openPanel(context);
    } catch (e) { /* ignore - openPanel's own error path handles a bad file */ }
  }

  // Without a serializer the panel is thrown away on every window reload and
  // has to be reopened by hand. With it, VS Code hands the panel back and the
  // board is re-rendered from .claude/notes.json.
  if (vscode.window.registerWebviewPanelSerializer) {
    context.subscriptions.push(
      vscode.window.registerWebviewPanelSerializer('claudeNotes', {
        deserializeWebviewPanel(restored) {
          restored.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
          };
          attachPanel(context, restored);
          return Promise.resolve();
        }
      })
    );
  }
  // A permanent way back to the board: click the status bar, or ctrl+alt+n.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'claudeNotes.open';
  status.text = '$(notebook) Notes';
  status.tooltip = 'Open the Claude Notes Panel (ctrl+alt+n)';
  status.show();
  context.subscriptions.push(status);

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeNotes.clear', () => {
      const notesPath = getNotesPath();
      if (notesPath) fs.writeFileSync(notesPath, '');
      // A new board makes any pen strokes/stickies anchored to the old
      // layout meaningless, so wipe them together with the board itself.
      writeFeedback(Object.assign({}, EMPTY_FEEDBACK));
      viewingSavedFile = null;
      lastLiveSpec = null;
      if (panel) panel.webview.postMessage({ type: 'clear' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeNotes.saveBoard', () => {
      const name = saveCurrentBoard();
      sendLibrary();
      if (name) vscode.window.showInformationMessage('Claude Notes: saved to .claude/notes/' + name);
      else vscode.window.showWarningMessage('Claude Notes: nothing to save yet.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeNotes.clearFeedback', () => {
      writeFeedback(Object.assign({}, EMPTY_FEEDBACK));
      if (panel) panel.webview.postMessage({ type: 'feedbackState', data: Object.assign({}, EMPTY_FEEDBACK) });
    })
  );
}

function deactivate() {
  if (watcher) watcher.dispose();
}

module.exports = { activate, deactivate };
