// Renders the WHOLE panel (toolbars + board), not just the board svg.
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = '/home/mostafa/Claude_Note/claude-notes-ext';
const board = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3];
const theme = process.argv[4] || 'vscode-dark';

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body data-vscode-theme-kind="${theme}" class="${theme}"><div id="app"></div></body></html>`,
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.org/' });
const w = dom.window;
let state;
w.acquireVsCodeApi = () => ({ postMessage() {}, getState: () => state, setState: (s) => (state = s) });
w.HTMLCanvasElement.prototype.getContext = function () {
  return { font: '', measureText: (t) => ({ width: String(t).length * 7 }) };
};
w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 40 });
w.Element.prototype.setPointerCapture = () => {};
w.Element.prototype.releasePointerCapture = () => {};
if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });

w.eval(fs.readFileSync(path.join(root, 'dist/webview.js'), 'utf8').replace(/^export\s*\{[^}]*\};?\s*$/m, ''));
w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'render', spec: board, generation: 1, watchedFolder: 'Claude_Note' } }));
await new Promise((r) => setTimeout(r, 120));

const css = fs.readFileSync(path.join(root, 'dist/webview.css'), 'utf8');
const light = theme.includes('light');
const bg = light ? '#ffffff' : '#1e1e1e';
// Approximate the variables VS Code injects, so a render is representative
// rather than a tour of the fallbacks.
const vars = light
  ? `--vscode-editor-background:#ffffff;--vscode-editor-foreground:#3b3b3b;
     --vscode-editorWidget-background:#f8f8f8;--vscode-editorWidget-border:#d4d4d4;
     --vscode-focusBorder:#005fb8;--vscode-descriptionForeground:#6a6a6a;
     --vscode-charts-red:#c4314b;--vscode-charts-blue:#1a72c4;--vscode-charts-green:#388a34;
     --vscode-charts-orange:#b5620a;--vscode-charts-purple:#652d90;--vscode-charts-yellow:#8f6a00;`
  : `--vscode-editor-background:#1e1e1e;--vscode-editor-foreground:#d4d4d4;
     --vscode-editorWidget-background:#252526;--vscode-editorWidget-border:#454545;
     --vscode-focusBorder:#007fd4;--vscode-descriptionForeground:#9d9d9d;
     --vscode-charts-red:#f14c4c;--vscode-charts-blue:#3794ff;--vscode-charts-green:#89d185;
     --vscode-charts-orange:#d18616;--vscode-charts-purple:#b180d7;--vscode-charts-yellow:#cca700;`;
fs.writeFileSync(out, `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${css}
html{${vars}}
html,body{margin:0;padding:0;height:100%;background:${bg}}
#app{position:relative;width:100%;height:100%}
</style></head><body data-vscode-theme-kind="${theme}" class="${theme}">${dom.window.document.getElementById('app').outerHTML}</body></html>`);
console.log('panel ->', out);
