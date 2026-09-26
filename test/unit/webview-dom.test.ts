import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';

/**
 * Drives the REAL built webview bundle in a DOM.
 *
 * jsdom is fine here and only here: these assertions are about wiring —
 * which ids exist, whether a click toggles state, whether a message gets
 * posted. They are NOT about geometry, which jsdom cannot do at all (no
 * getBBox). Layout is tested separately with an injected measurer.
 *
 * This suite exists because three bugs shipped that every other layer missed:
 * the toolbar had no id so its entire stylesheet was dead, pen/note appeared
 * not to work, and the style selector looked inert.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const bundlePath = path.join(root, 'dist/webview.js');
const cssPath = path.join(root, 'dist/webview.css');

interface Harness {
  dom: JSDOM;
  doc: Document;
  posted: Record<string, unknown>[];
  send(msg: Record<string, unknown>): void;
  $(sel: string): Element | null;
  btn(label: string): HTMLButtonElement;
}

let h: Harness;

const BOARD = {
  title: 'harness board',
  frames: [{ id: 'f', title: 'group', nodes: ['a', 'b'] }],
  nodes: [
    { id: 'a', label: 'alpha', kind: 'base' },
    { id: 'b', label: 'beta', kind: 'problem' }
  ],
  edges: [{ from: 'a', to: 'b', label: 'link' }],
  questions: [{ id: 'q1', text: 'Keep the old table?' }]
};

async function boot(): Promise<Harness> {
  expect(fs.existsSync(bundlePath), 'dist/webview.js — run `npm run compile` first').toBe(true);
  const code = fs.readFileSync(bundlePath, 'utf8');

  const dom = new JSDOM(
    `<!DOCTYPE html><html><head></head><body data-vscode-theme-kind="vscode-dark"><div id="app"></div></body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.org/' }
  );
  const w = dom.window as unknown as Window & typeof globalThis & Record<string, unknown>;

  const posted: Record<string, unknown>[] = [];
  let state: unknown = undefined;
  w.acquireVsCodeApi = () =>
    ({
      postMessage: (m: Record<string, unknown>) => posted.push(m),
      getState: () => state,
      setState: (s: unknown) => {
        state = s;
        return s;
      }
    }) as never;

  // jsdom implements no SVG layout; stub only what the wiring path touches.
  const SVGProto = (w as unknown as { SVGElement: { prototype: Record<string, unknown> } }).SVGElement.prototype;
  SVGProto.getBBox = () => ({ x: 0, y: 0, width: 100, height: 40 });
  (w.Element.prototype as unknown as Record<string, unknown>).setPointerCapture = () => {};
  (w.Element.prototype as unknown as Record<string, unknown>).releasePointerCapture = () => {};
  // jsdom has no 2d context; give it a plausible measureText so layout runs.
  (w.HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext = function () {
    return { font: '', measureText: (t: string) => ({ width: String(t).length * 7 }) };
  };
  if (!w.requestAnimationFrame) w.requestAnimationFrame = ((cb: () => void) => setTimeout(cb, 0)) as never;
  if (!w.matchMedia) w.matchMedia = (() => ({ matches: false, addListener() {}, removeListener() {} })) as never;

  // esbuild emits ESM; strip the export footer so it can run as a script.
  dom.window.eval(code.replace(/^export\s*\{[^}]*\};?\s*$/m, ''));

  const doc = dom.window.document;
  // The stylesheet the extension serves alongside the bundle.
  const style = doc.createElement('style');
  style.textContent = fs.readFileSync(cssPath, 'utf8');
  doc.head.appendChild(style);

  const harness: Harness = {
    dom,
    doc,
    posted,
    send(msg) {
      dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: msg }));
    },
    $(sel) {
      return doc.querySelector(sel);
    },
    btn(label) {
      const b = [...doc.querySelectorAll('button')].find((x) => x.textContent?.trim() === label);
      if (!b) throw new Error(`no button labelled "${label}". Found: ${[...doc.querySelectorAll('button')].map((x) => x.textContent).join(', ')}`);
      return b as HTMLButtonElement;
    }
  };
  return harness;
}

beforeEach(async () => {
  h = await boot();
  h.send({ type: 'themeChanged', kind: 'dark' });
  h.send({ type: 'render', spec: BOARD, generation: 1 });
  await new Promise((r) => setTimeout(r, 30));
});

afterEach(() => {
  h.dom.window.close();
  vi.restoreAllMocks();
});

describe('the toolbar is actually wired to its stylesheet', () => {
  // THE BUG: `bar` was created with a CLASS but the stylesheet targets `#bar`.
  // Every toolbar rule was dead - no fixed bar, no button styling, and no
  // visible pressed state, which is why Pen and Note looked broken.
  it('the toolbar has the id the stylesheet targets', () => {
    expect(h.$('#bar'), 'no #bar — every `#bar ...` rule in the stylesheet is dead').not.toBeNull();
  });

  it('every id the stylesheet targets exists in the DOM', () => {
    const css = fs.readFileSync(cssPath, 'utf8');
    // id selectors only — not the hex colours in var() fallbacks.
    const ids = [
      ...new Set(
        [...css.matchAll(/(?:^|[\s,>+~{])#([a-zA-Z][\w-]*)/gm)]
          .map((m) => m[1])
          .filter((id) => !/^[0-9a-fA-F]{3,8}$/.test(id))
      )
    ];
    const missing = ids.filter((id) => !h.doc.getElementById(id));
    expect(missing, `stylesheet targets ids that do not exist: ${missing.join(', ')}`).toEqual([]);
  });

  it('the canvas sits below the toolbar rather than under it', () => {
    const bar = h.$('#bar') as HTMLElement;
    expect(bar).not.toBeNull();
    // The stylesheet reserves 38px; the bar must declare a matching height.
    const css = fs.readFileSync(cssPath, 'utf8');
    const barH = /#bar\s*\{[^}]*height:\s*(\d+)px/.exec(css)?.[1];
    const canvasTop = /#canvas\s*\{[^}]*inset:\s*(\d+)px/.exec(css)?.[1];
    expect(barH, 'no #bar height in the stylesheet').toBeDefined();
    expect(canvasTop, 'no #canvas inset in the stylesheet').toBeDefined();
    expect(canvasTop).toBe(barH);
  });
});

describe('pen and note toggle', () => {
  it('Pen sets aria-pressed and enables overlay pointer events', () => {
    const pen = h.btn('Pen');
    expect(pen.getAttribute('aria-pressed')).toBe('false');
    pen.click();
    expect(pen.getAttribute('aria-pressed'), 'Pen did not report itself pressed').toBe('true');
    const overlay = h.$('#overlay') as unknown as SVGElement;
    expect(overlay.style.pointerEvents, 'the overlay cannot receive the pointer, so drawing is impossible').toBe('auto');
  });

  it('clicking Pen again returns to pan', () => {
    const pen = h.btn('Pen');
    pen.click();
    pen.click();
    expect(pen.getAttribute('aria-pressed')).toBe('false');
    expect((h.$('#overlay') as unknown as SVGElement).style.pointerEvents).toBe('none');
  });

  it('Pen and Note are mutually exclusive', () => {
    h.btn('Pen').click();
    h.btn('Note').click();
    expect(h.btn('Pen').getAttribute('aria-pressed')).toBe('false');
    expect(h.btn('Note').getAttribute('aria-pressed')).toBe('true');
  });

  it('the mode hint tells the user what to do', () => {
    h.btn('Pen').click();
    expect((h.$('#modehint') as HTMLElement).textContent).toMatch(/draw/i);
  });

  it('a drag in pen mode posts a drawing', async () => {
    h.btn('Pen').click();
    const overlay = h.$('#overlay') as unknown as SVGElement;
    const ev = (type: string, x: number, y: number) => {
      const e = new h.dom.window.Event(type, { bubbles: true }) as unknown as Record<string, unknown>;
      e.clientX = x;
      e.clientY = y;
      e.pointerId = 1;
      overlay.dispatchEvent(e as unknown as Event);
    };
    ev('pointerdown', 10, 10);
    for (let i = 1; i <= 20; i++) ev('pointermove', 10 + i * 4, 10 + i * 2);
    ev('pointerup', 90, 50);

    const drawing = h.posted.find((m) => m.type === 'feedback' && m.kind === 'drawing');
    expect(drawing, `no drawing posted. Posted: ${h.posted.map((m) => m.type + '/' + (m.kind ?? '')).join(', ')}`).toBeDefined();
    const pts = (drawing!.payload as { points: [number, number][] }).points;
    expect(pts.length).toBeGreaterThanOrEqual(2);
    expect(pts.length, 'stroke was not decimated').toBeLessThan(20);
  });

  it('a click in note mode creates an editable sticky', () => {
    h.btn('Note').click();
    const overlay = h.$('#overlay') as unknown as SVGElement;
    const e = new h.dom.window.Event('pointerdown', { bubbles: true }) as unknown as Record<string, unknown>;
    e.clientX = 40;
    e.clientY = 40;
    e.pointerId = 1;
    overlay.dispatchEvent(e as unknown as Event);
    expect(h.$('.sticky-note'), 'no sticky textarea was created').not.toBeNull();
  });
});

describe('render style switching', () => {
  it('the selector exists and offers all three styles', () => {
    const sel = h.$('#style') as HTMLSelectElement;
    expect(sel).not.toBeNull();
    expect([...sel.options].map((o) => o.value)).toEqual(['sketchy', 'clean', 'mermaid']);
  });

  it('changing it redraws and tells the host', () => {
    const sel = h.$('#style') as HTMLSelectElement;
    const before = h.$('#viewport')!.innerHTML;
    sel.value = 'clean';
    sel.dispatchEvent(new h.dom.window.Event('change', { bubbles: true }));

    expect(h.posted.some((m) => m.type === 'styleChanged' && m.style === 'clean')).toBe(true);
    expect(h.$('#viewport')!.innerHTML, 'the board did not re-render in the new style').not.toBe(before);
  });

  it('clean output has no rough.js multi-stroke paths', () => {
    const sel = h.$('#style') as HTMLSelectElement;
    sel.value = 'clean';
    sel.dispatchEvent(new h.dom.window.Event('change', { bubbles: true }));
    const svg = h.$('#viewport svg')!;
    // The clean pen emits <rect>; the sketchy pen emits only <path>.
    expect(svg.querySelectorAll('rect').length, 'clean style drew no rects — it is still the sketchy pen').toBeGreaterThan(0);
  });

  it('a setStyle message from the host switches the style', () => {
    h.send({ type: 'setStyle', style: 'clean' });
    expect((h.$('#style') as HTMLSelectElement).value).toBe('clean');
  });

  it('the style survives a re-render of the same board', async () => {
    const sel = h.$('#style') as HTMLSelectElement;
    sel.value = 'clean';
    sel.dispatchEvent(new h.dom.window.Event('change', { bubbles: true }));
    h.send({ type: 'render', spec: BOARD, generation: 2 });
    await new Promise((r) => setTimeout(r, 30));
    expect(sel.value, 'the style reset itself on the next board update').toBe('clean');
  });
});

describe('the board renders at all', () => {
  it('produces an svg with the board content', () => {
    const svg = h.$('#viewport svg');
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll('text').length).toBeGreaterThan(0);
    expect(svg!.getAttribute('role')).toBe('graphics-document');
  });

  it('exposes a text description', () => {
    expect(h.$('#description')!.textContent).toContain('harness board');
  });

  it('shows the questions button when the board has questions', () => {
    expect((h.btn('Questions') as HTMLButtonElement).hidden).toBe(false);
  });

  it('drops a superseded render', async () => {
    h.send({ type: 'render', spec: { ...BOARD, title: 'newer' }, generation: 9 });
    await new Promise((r) => setTimeout(r, 20));
    h.send({ type: 'render', spec: { ...BOARD, title: 'stale' }, generation: 2 });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.$('#title')!.textContent).toBe('newer');
  });
});
