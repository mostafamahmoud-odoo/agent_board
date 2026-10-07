import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = '/home/mostafa/Claude_Note/agent-board-ext';
const board = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const style = process.argv[3] || 'sketchy';
const out = process.argv[4];

const dom = new JSDOM(
  `<!DOCTYPE html><html><head></head><body data-vscode-theme-kind="vscode-dark"><div id="app"></div></body></html>`,
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

const code = fs.readFileSync(path.join(root, 'dist/webview.js'), 'utf8').replace(/^export\s*\{[^}]*\};?\s*$/m, '');
w.eval(code);

w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'setStyle', style } }));
w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'render', spec: board, generation: 1 } }));

await new Promise((r) => setTimeout(r, 120));
const svg = dom.window.document.querySelector('#viewport svg');
if (!svg) { console.error('NO SVG RENDERED'); process.exit(1); }
const css = fs.readFileSync(path.join(root, 'dist/webview.css'), 'utf8');
const W = svg.getAttribute('width'), H = svg.getAttribute('height');
fs.writeFileSync(out,
`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${css}
html,body{margin:0;padding:0;background:#1e1e1e;width:${W}px;height:${H}px;overflow:hidden}
</style></head><body class="vscode-dark">${svg.outerHTML}</body></html>`);
console.log(`${style}: ${W}x${H} -> ${out}`);
