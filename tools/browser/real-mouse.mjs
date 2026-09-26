/**
 * Drives the panel with a REAL mouse through the DevTools protocol.
 *
 * The previous probe dispatched synthetic PointerEvents at an element it
 * picked itself, so it never exercised the browser's hit-testing — it proved
 * the handlers worked if you could reach them, not that you could reach them.
 * Input.dispatchMouseEvent goes through the real pipeline: whatever is
 * topmost at that coordinate gets the event.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const dir = path.join(root, 'tools/browser');
for (const f of ['webview.js', 'webview.css']) fs.copyFileSync(path.join(root, 'dist', f), path.join(dir, f));
fs.copyFileSync(path.join(root, 'media/vendor/mermaid.min.js'), path.join(dir, 'mermaid.min.js'));

const PORT = 8751, CDP = 9333;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
  { cwd: dir, stdio: 'ignore', detached: true });
const profile = fs.mkdtempSync('/tmp/cnp-cdp-');
const chrome = spawn(process.env.CHROME || 'google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`,
  '--window-size=1000,700', `http://127.0.0.1:${PORT}/live.html`
], { stdio: 'ignore', detached: true });

const cleanup = () => {
  for (const p of [server, chrome]) { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } }
  fs.rmSync(profile, { recursive: true, force: true });
};
process.on('exit', cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2500);

let targets;
for (let i = 0; i < 30; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
    if (targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)) break;
  } catch { /* not up yet */ }
  await sleep(400);
}
const target = targets?.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
if (!target) { console.error('could not reach Chrome via CDP'); cleanup(); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

await sleep(1200);

// Render a board, then find where things actually are on screen.
await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'render',generation:1,spec:{
  title:'real mouse', frames:[{id:'f',title:'g',nodes:['a']}], nodes:[{id:'a',label:'node'}]}}}))`);
await sleep(600);

const geom = await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Pen');
  const r = b.getBoundingClientRect();
  const c = document.getElementById('canvas').getBoundingClientRect();
  return { pen:[r.left+r.width/2, r.top+r.height/2], canvas:[c.left,c.top,c.width,c.height] };
})()`);

const mouse = async (type, x, y, extra = {}) =>
  send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1, pointerType: 'mouse', ...extra
  });

const results = {};
let failed = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failed++;
  results[label] = `${ok ? '✓' : '✗'} ${got}${ok ? '' : `  (expected ${want})`}`;
};
const strokes = () => evaluate(`window.__posted.filter(m=>m.kind==='drawing').length`);
const armed = () => evaluate(
  `[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Pen').getAttribute('aria-pressed')`);

// 1. click the Pen button with a real mouse -> armed, cursor changes, nothing drawn
await mouse('mousePressed', geom.pen[0], geom.pen[1]);
await mouse('mouseReleased', geom.pen[0], geom.pen[1]);
await sleep(200);
check('pen arms on click', await armed(), 'true');
check('cursor becomes the tool', await evaluate(`document.getElementById('canvas').dataset.tool`), 'pen');
check('arming draws nothing', await strokes(), 0);

// 2. move with the button UP -> still nothing
for (let i = 0; i < 10; i++) await mouse('mouseMoved', 480 + i * 12, 300, { buttons: 0 });
await sleep(150);
check('hovering draws nothing', await strokes(), 0);

// 3. press, drag, release -> exactly one stroke
await mouse('mousePressed', 500, 300);
for (let i = 1; i <= 12; i++) await mouse('mouseMoved', 500 + i * 12, 300 + i * 6);
await mouse('mouseReleased', 644, 372);
await sleep(300);
check('one press-drag-release = one stroke', await strokes(), 1);
check('pen stays armed', await armed(), 'true');

// 4. a second stroke without touching the toolbar
await mouse('mousePressed', 300, 460);
for (let i = 1; i <= 12; i++) await mouse('mouseMoved', 300 + i * 10, 460);
await mouse('mouseReleased', 420, 460);
await sleep(300);
check('a second stroke needs no re-click', await strokes(), 2);

// Coordinates come from the REAL viewport. Hardcoding them put a test point
// below the window, which failed as a product bug when it was a bad test.
const vp = await evaluate(`({ w: innerWidth, h: innerHeight })`);
const board = await evaluate(
  `(() => { const r = document.querySelector('#viewport svg').getBoundingClientRect();
     return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
// a point on the canvas but clear of the board and of both toolbars
const away = { x: Math.round(Math.min(board.l / 2 + 20, vp.w - 40)), y: Math.round((board.b + vp.h) / 2) };

// 5. a stroke well OUTSIDE the board - the case that used to die mid-drag
//    because event delivery was bounded by the overlay's own box
await mouse('mousePressed', away.x, away.y);
for (let i = 1; i <= 12; i++) await mouse('mouseMoved', away.x + i * 8, away.y - i * 2);
await mouse('mouseReleased', away.x + 96, away.y - 24);
await sleep(300);
check('drawing works away from the board', await strokes(), 3);

// 6. release outside the window entirely (pointer capture must hold)
// starts inside, ends far outside the window: only pointer capture saves this
await mouse('mousePressed', Math.round(vp.w * 0.6), Math.round(vp.h * 0.5));
for (let i = 1; i <= 8; i++) await mouse('mouseMoved', Math.round(vp.w * 0.6) + i * 40, Math.round(vp.h * 0.5) - i * 30);
await mouse('mouseReleased', vp.w + 400, -200);
await sleep(300);
check('a drag that leaves the panel still lands', await strokes(), 4);

// 7. Escape puts it away
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(200);
check('Escape puts the pen away', await armed(), 'false');

// 8. with the pen away, a drag pans instead of drawing
await mouse('mousePressed', Math.round(vp.w / 2), Math.round(vp.h / 2));
for (let i = 1; i <= 6; i++) await mouse('mouseMoved', Math.round(vp.w / 2) + i * 15, Math.round(vp.h / 2));
await mouse('mouseReleased', Math.round(vp.w / 2) + 90, Math.round(vp.h / 2));
await sleep(250);
check('with the pen away, dragging does not draw', await strokes(), 4);

console.log('\nPEN, driven by a real mouse through the browser:\n');
for (const [k, v] of Object.entries(results)) console.log(`  ${k.padEnd(38)} ${v}`);
console.log(failed ? `\n${failed} check(s) FAILED\n` : '\nall checks passed\n');
cleanup();
process.exit(failed ? 1 : 0);
