// Runs the browser probes and prints their results. See README.md.
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const root = path.resolve(import.meta.dirname, '../..');
const dir = path.join(root, 'tools/browser');
for (const f of ['webview.js', 'webview.css']) {
  fs.copyFileSync(path.join(root, 'dist', f), path.join(dir, f));
}
fs.copyFileSync(path.join(root, 'media/vendor/mermaid.min.js'), path.join(dir, 'mermaid.min.js'));

const PORT = 8749;

/*
 * The static server runs in ITS OWN PROCESS on purpose. An in-process
 * http.createServer deadlocks here: execSync blocks Node's event loop, so the
 * server can never answer the request Chrome is waiting on, and the probe
 * hangs until its timeout instead of failing.
 */
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: dir,
  stdio: 'ignore',
  detached: true
});
const stop = () => { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* already gone */ } };
process.on('exit', stop);
await new Promise((r) => setTimeout(r, 700));
const chrome = process.env.CHROME || 'google-chrome';
let failed = 0;

function dump(page) {
  return execSync(
    `${chrome} --headless --disable-gpu --no-sandbox --virtual-time-budget=9000 --dump-dom http://127.0.0.1:${PORT}/${page}`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }
  );
}

// --- pen ---
const penDom = dump('pen-probe.html');
const out = /<pre id="out"[^>]*>([\s\S]*?)<\/pre>/.exec(penDom)?.[1] ?? '';
const results = Object.fromEntries(
  out.replace(/&#10;/g, '\n').split('\n').filter(Boolean).map((l) => l.split(': ').map((x) => x.trim()))
);
console.log('\npen:');
const expect = (k, want) => {
  const ok = String(results[k]) === String(want);
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${k} = ${results[k]} ${ok ? '' : `(expected ${want})`}`);
};
expect('armed after click', 'true');
expect('canvas tool', 'pen');
expect('drawings after arming', '0');
expect('drawings after hover', '0');
expect('drawings after one stroke', '1');
expect('still armed', 'true');
expect('drawings after two strokes', '2');

// --- mermaid, UNDER THE REAL CSP ---
// The first mermaid probe had no CSP at all, so it passed while the panel
// rendered a completely unstyled diagram: mermaid injects a <style> element
// and per-node style attributes, and a tight style-src blocks every one.
const cDom = dump('csp-probe.html');
const cspOut = /<pre id="out"[^>]*>([\s\S]*?)<\/pre>/.exec(cDom)?.[1]?.replace(/&#10;/g, '\n') ?? '';
const line = (k) => (new RegExp(`${k}: (.*)`).exec(cspOut)?.[1] ?? '').trim();
console.log('\nmermaid (under the panel CSP):');
const mCheck = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${got}${ok ? '' : ` (expected ${want})`}`);
};
mCheck('diagram renders', line('diagram rendered'), 'YES');
mCheck('no error banner', line('banner'), '(none)');
mCheck('no CSP violations', line('csp violations'), 'none');

stop();
console.log(failed ? `\n${failed} probe(s) failed\n` : '\nall probes passed\n');
process.exit(failed ? 1 : 0);
