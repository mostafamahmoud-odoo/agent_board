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
  /*
   * These tests drive the SVG canvas — the pen, sticky notes, dragging
   * elements — so the harness starts on the sketchy style, as a user who last
   * chose it would. The panel default is draw.io, which is a remote iframe
   * with none of those tools, and booting there failed all 15 at once.
   */
  let state: unknown = { style: 'sketchy' };
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
  // jsdom has no pointer capture at all. Stub it, and record it, so a test
  // can assert the pen actually asks for capture — its absence is what let a
  // stroke die mid-drag in the real browser.
  (w as unknown as { __captured: unknown[] }).__captured = [];
  (w.Element.prototype as unknown as Record<string, unknown>).setPointerCapture = function (this: unknown, id: number) {
    const el = this as { id?: string; tagName?: string };
    (w as unknown as { __captured: unknown[] }).__captured.push([el.id || el.tagName, id]);
  };
  (w.Element.prototype as unknown as Record<string, unknown>).releasePointerCapture = () => {};
  (w.Element.prototype as unknown as Record<string, unknown>).hasPointerCapture = () => true;
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
      const all = [...doc.querySelectorAll('button')];
      const b = all.find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim() === label);
      if (!b) {
        throw new Error(
          `no button named "${label}". Found: ${all.map((x) => x.getAttribute('aria-label') || x.textContent).join(' | ')}`
        );
      }
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
    // Elements only present under a particular render style are asserted
    // where that style is tested, not here.
    // Both belong to the draw.io canvas, which mounts on <body> only while
    // that style is active; the drawio tests assert them.
    const conditional = new Set(['drawio', 'drawio-status']);
    const missing = ids.filter((id) => !conditional.has(id) && !h.doc.getElementById(id));
    expect(missing, `stylesheet targets ids that do not exist: ${missing.join(', ')}`).toEqual([]);
  });

  it('the hidden attribute actually hides a toolbar button', () => {
    // `.tb-btn { display: inline-flex }` beat the `hidden` attribute, so the
    // Questions button showed on boards that had no questions.
    const css = fs.readFileSync(cssPath, 'utf8');
    expect(css, 'nothing makes [hidden] win over a class display rule').toMatch(/\[hidden\][^{]*\{[^}]*display:\s*none/);
  });

  it('every toolbar control has an accessible name', () => {
    // The toolbar is icon-only, so this is the only thing naming its controls.
    const unnamed = [...h.doc.querySelectorAll('#bar button, #viewbar button')].filter(
      (b) => !(b.getAttribute('aria-label') || b.textContent || '').trim()
    );
    expect(unnamed).toHaveLength(0);
  });
});

describe('pen and note toggle', () => {
  it('Pen reports itself pressed and arms the canvas', () => {
    const pen = h.btn('Pen');
    expect(pen.getAttribute('aria-pressed')).toBe('false');
    pen.click();
    expect(pen.getAttribute('aria-pressed'), 'Pen did not report itself pressed').toBe('true');
    expect((h.$('#canvas') as HTMLElement).dataset.tool, 'the canvas is not armed, so nothing can draw').toBe('pen');
  });

  it('clicking Pen again returns to pan', () => {
    const pen = h.btn('Pen');
    pen.click();
    pen.click();
    expect(pen.getAttribute('aria-pressed')).toBe('false');
    expect((h.$('#canvas') as HTMLElement).dataset.tool).toBe('select');
  });

  it('Pen and Note are mutually exclusive', () => {
    h.btn('Pen').click();
    h.btn('Sticky note').click();
    expect(h.btn('Pen').getAttribute('aria-pressed')).toBe('false');
    expect(h.btn('Sticky note').getAttribute('aria-pressed')).toBe('true');
  });

  it('selecting a tool deselects the others', () => {
    h.btn('Pen').click();
    expect(h.btn('Select').getAttribute('aria-pressed')).toBe('false');
    expect(h.btn('Pen').getAttribute('aria-pressed')).toBe('true');
  });

  it('the pen STAYS armed after a stroke, so you can draw again', () => {
    // A drawing tool that disarms on mouse-up means re-clicking Pen before
    // every line. Releasing ends the stroke; it does not put the tool away.
    h.btn('Pen').click();
    const surface = h.$('#canvas') as HTMLElement;
    const ev = (type: string, x: number, y: number) => {
      const e = new h.dom.window.Event(type, { bubbles: true }) as unknown as Record<string, unknown>;
      e.clientX = x; e.clientY = y; e.pointerId = 1; e.button = 0;
      surface.dispatchEvent(e as unknown as Event);
    };
    ev('pointerdown', 10, 10);
    for (let i = 1; i <= 10; i++) ev('pointermove', 10 + i * 5, 10 + i * 3);
    ev('pointerup', 60, 40);
    expect(h.btn('Pen').getAttribute('aria-pressed'), 'the pen disarmed itself on mouse-up').toBe('true');

    // ...and a second stroke works without touching the toolbar again.
    const before = h.posted.filter((m) => m.type === 'feedback' && m.kind === 'drawing').length;
    ev('pointerdown', 200, 200);
    for (let i = 1; i <= 10; i++) ev('pointermove', 200 + i * 5, 200 + i * 3);
    ev('pointerup', 250, 230);
    const after = h.posted.filter((m) => m.type === 'feedback' && m.kind === 'drawing').length;
    expect(after, 'a second stroke did not draw').toBe(before + 1);
  });

  it('nothing is drawn while the mouse is up', () => {
    h.btn('Pen').click();
    const surface = h.$('#canvas') as HTMLElement;
    const ev = (type: string, x: number, y: number) => {
      const e = new h.dom.window.Event(type, { bubbles: true }) as unknown as Record<string, unknown>;
      e.clientX = x; e.clientY = y; e.pointerId = 1; e.button = 0;
      surface.dispatchEvent(e as unknown as Event);
    };
    for (let i = 0; i < 10; i++) ev('pointermove', 30 + i * 8, 30);
    expect(h.posted.some((m) => m.type === 'feedback' && m.kind === 'drawing'), 'moving with the button up drew something').toBe(false);
  });

  it('Escape puts the pen away', () => {
    h.btn('Pen').click();
    expect(h.btn('Pen').getAttribute('aria-pressed')).toBe('true');
    h.doc.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    h.dom.window.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(h.btn('Pen').getAttribute('aria-pressed')).toBe('false');
  });

  it('the pen takes pointer capture on the CANVAS, not the overlay', () => {
    // setPointerCapture on the overlay <svg> silently failed in a real
    // browser, and event delivery was bounded by that svg's own box — so a
    // stroke died the moment the pointer left the board. Capture must be
    // taken on the canvas, which always fills the panel.
    h.btn('Pen').click();
    const surface = h.$('#canvas') as HTMLElement;
    const e = new h.dom.window.Event('pointerdown', { bubbles: true }) as unknown as Record<string, unknown>;
    e.clientX = 60; e.clientY = 60; e.pointerId = 7; e.button = 0;
    surface.dispatchEvent(e as unknown as Event);
    const captured = (h.dom.window as unknown as { __captured: [string, number][] }).__captured;
    expect(captured.some(([who, id]) => who === 'canvas' && id === 7), `capture went to: ${JSON.stringify(captured)}`).toBe(true);
  });

  it('the overlay never takes the pointer itself', () => {
    h.btn('Pen').click();
    expect((h.$('#overlay') as unknown as SVGElement).style.pointerEvents).toBe('none');
  });

  it('the canvas advertises the armed tool, so the cursor can change', () => {
    const canvas = h.$('#canvas') as HTMLElement;
    h.btn('Pen').click();
    expect(canvas.dataset.tool, 'the canvas does not know a tool is armed').toBe('pen');
    h.btn('Sticky note').click();
    expect(canvas.dataset.tool).toBe('note');
  });

  it('a drag in pen mode posts a drawing', async () => {
    h.btn('Pen').click();
    const surface = h.$('#canvas') as HTMLElement;
    const ev = (type: string, x: number, y: number) => {
      const e = new h.dom.window.Event(type, { bubbles: true }) as unknown as Record<string, unknown>;
      e.clientX = x;
      e.clientY = y;
      e.pointerId = 1;
      e.button = 0;
      surface.dispatchEvent(e as unknown as Event);
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

  const pointer = (target: EventTarget, type: string, x: number, y: number) => {
    const e = new h.dom.window.Event(type, { bubbles: true }) as unknown as Record<string, unknown>;
    e.clientX = x; e.clientY = y; e.pointerId = 1; e.button = 0;
    target.dispatchEvent(e as unknown as Event);
  };

  const placeNote = (text: string) => {
    h.btn('Sticky note').click();
    pointer(h.$('#canvas')!, 'pointerdown', 40, 40);
    const ta = h.$('.sticky-note') as HTMLTextAreaElement;
    ta.value = text;
    ta.dispatchEvent(new h.dom.window.Event('blur', { bubbles: false }));
    return ta;
  };

  it('a new note is editable, not read-only', () => {
    h.btn('Sticky note').click();
    pointer(h.$('#canvas')!, 'pointerdown', 40, 40);
    const ta = h.$('.sticky-note') as HTMLTextAreaElement;
    expect(ta, 'no sticky was created').not.toBeNull();
    expect(ta.readOnly, 'a brand new note was read-only').toBe(false);
  });

  it('an existing note can be re-opened for editing', async () => {
    // commit() used to set readOnly = true permanently, so a note could be
    // written exactly once and never corrected.
    h.send({
      type: 'feedbackState',
      data: {
        answers: [], drawings: [],
        stickies: [{ id: 's-1', at: new Date().toISOString(), x: 10, y: 10, text: 'existing', boardTitle: 'harness board' }]
      }
    });
    await new Promise((r) => setTimeout(r, 20));
    const ta = h.$('.sticky-note') as HTMLTextAreaElement;
    expect(ta, 'the restored note was not drawn').not.toBeNull();
    expect(ta.value).toBe('existing');
    pointer(ta, 'pointerdown', 20, 20);
    expect(ta.readOnly, 'clicking a restored note did not make it editable').toBe(false);
  });

  it('editing an existing note UPDATES it instead of adding a second one', async () => {
    h.send({
      type: 'feedbackState',
      data: {
        answers: [], drawings: [],
        stickies: [{ id: 's-1', at: new Date().toISOString(), x: 10, y: 10, text: 'before', boardTitle: 'harness board' }]
      }
    });
    await new Promise((r) => setTimeout(r, 20));
    const ta = h.$('.sticky-note') as HTMLTextAreaElement;
    pointer(ta, 'pointerdown', 20, 20);
    ta.value = 'after';
    ta.dispatchEvent(new h.dom.window.Event('blur', { bubbles: false }));

    const update = h.posted.find((m) => m.type === 'updateMark');
    expect(update, 'an edit did not post updateMark').toBeDefined();
    expect((update as { id: string }).id).toBe('s-1');
    expect(h.posted.some((m) => m.type === 'feedback' && m.kind === 'sticky'), 'the edit appended a duplicate note').toBe(false);
  });

  it('a note can be dragged, and the move is persisted', async () => {
    h.send({
      type: 'feedbackState',
      data: {
        answers: [], drawings: [],
        stickies: [{ id: 's-1', at: new Date().toISOString(), x: 10, y: 10, text: 'drag me', boardTitle: 'harness board' }]
      }
    });
    await new Promise((r) => setTimeout(r, 20));
    const grip = h.$('.sticky-grip') as HTMLElement;
    expect(grip, 'a note has no drag handle').not.toBeNull();
    const fo = h.$('.sticky-fo') as unknown as SVGElement;
    const x0 = fo.getAttribute('x');
    pointer(grip, 'pointerdown', 50, 50);
    pointer(grip, 'pointermove', 140, 96);
    pointer(grip, 'pointerup', 140, 96);
    expect(fo.getAttribute('x'), 'the note did not move').not.toBe(x0);
    const moved = h.posted.filter((m) => m.type === 'updateMark');
    expect(moved.length, 'the move was not persisted').toBeGreaterThan(0);
  });

  it('a note can be deleted', async () => {
    h.send({
      type: 'feedbackState',
      data: {
        answers: [], drawings: [],
        stickies: [{ id: 's-1', at: new Date().toISOString(), x: 10, y: 10, text: 'bye', boardTitle: 'harness board' }]
      }
    });
    await new Promise((r) => setTimeout(r, 20));
    (h.$('.sticky-del') as HTMLButtonElement).click();
    expect(h.$('.sticky-note'), 'the note is still on the board').toBeNull();
    expect(h.posted.some((m) => m.type === 'deleteMark')).toBe(true);
  });

  it('an empty note is discarded rather than saved', () => {
    placeNote('   ');
    expect(h.$('.sticky-note')).toBeNull();
    expect(h.posted.some((m) => m.type === 'feedback' && m.kind === 'sticky')).toBe(false);
  });

  it('a click in note mode creates an editable sticky', () => {
    h.btn('Sticky note').click();
    const surface = h.$('#canvas') as HTMLElement;
    const e = new h.dom.window.Event('pointerdown', { bubbles: true }) as unknown as Record<string, unknown>;
    e.clientX = 40;
    e.clientY = 40;
    e.pointerId = 1;
    e.button = 0;
    surface.dispatchEvent(e as unknown as Event);
    expect(h.$('.sticky-note'), 'no sticky textarea was created').not.toBeNull();
  });
});

describe('render style switching', () => {
  const openStyleMenu = () => {
    h.btn('Render style').click();
    return [...h.doc.querySelectorAll('#menu .menu-item')] as HTMLButtonElement[];
  };

  it('the style menu offers every style this board can actually be drawn as', () => {
    const items = openStyleMenu();
    const text = items.map((i) => i.textContent).join(' ');
    expect(text).toMatch(/Sketchy.*Clean.*Mermaid.*draw\.io/s);
    expect(items).toHaveLength(4);
  });

  it('does not offer a style the board cannot be drawn as', () => {
    // An empty board has nothing to derive a mermaid diagram from.
    h.send({ type: 'render', spec: { title: 'harness board' }, generation: 5 });
    const labels = (() => {
      h.btn('Render style').click();
      return [...h.doc.querySelectorAll('#menu .menu-item')].map((i) => i.textContent || '');
    })();
    expect(labels.join(' '), 'Mermaid was offered for a board with nothing in it').not.toMatch(/Mermaid/);
  });

  it('choosing a style redraws and tells the host', () => {
    const before = h.$('#viewport')!.innerHTML;
    openStyleMenu()[1].click(); // Clean
    expect(h.posted.some((m) => m.type === 'styleChanged' && m.style === 'clean')).toBe(true);
    expect(h.$('#viewport')!.innerHTML, 'the board did not re-render in the new style').not.toBe(before);
  });

  it('clean output has no rough.js multi-stroke paths', () => {
    openStyleMenu()[1].click();
    const svg = h.$('#viewport svg')!;
    // The clean pen emits <rect>; the sketchy pen emits only <path>.
    expect(svg.querySelectorAll('rect').length, 'clean style drew no rects — it is still the sketchy pen').toBeGreaterThan(0);
  });

  it('a board may ASK for a style, and gets it', async () => {
    // `style: "drawio"` in the spec used to be ignored — only mermaid was
    // honoured — so a board asking for it silently rendered as sketchy.
    h.send({ type: 'render', spec: { ...BOARD, title: 'asks for clean', style: 'clean' }, generation: 7 });
    await new Promise((r) => setTimeout(r, 40));
    expect(h.$('#viewport svg')!.querySelectorAll('rect').length, 'the board did not get the style it asked for').toBeGreaterThan(0);
  });

  it('the toolbar overrides what the board asked for', async () => {
    h.send({ type: 'render', spec: { ...BOARD, title: 'asks for clean', style: 'clean' }, generation: 8 });
    await new Promise((r) => setTimeout(r, 40));
    openStyleMenu()[0].click(); // Sketchy
    await new Promise((r) => setTimeout(r, 40));
    h.send({ type: 'render', spec: { ...BOARD, title: 'asks for clean', style: 'clean' }, generation: 9 });
    await new Promise((r) => setTimeout(r, 40));
    expect(h.posted.some((m) => m.type === 'styleChanged' && m.style === 'sketchy')).toBe(true);
  });

  it('asking for the draw.io style mounts the editor', async () => {
    h.send({ type: 'render', spec: { ...BOARD, title: 'wants drawio', style: 'drawio' }, generation: 11 });
    await new Promise((r) => setTimeout(r, 60));
    const f = h.$('#drawio') as HTMLIFrameElement | null;
    expect(f, 'the draw.io canvas was not mounted').not.toBeNull();
    expect(f!.src, 'the embed url is wrong').toMatch(/embed=1.*proto=json/);
  });

  it('a setStyle message from the host switches the style', async () => {
    h.send({ type: 'setStyle', style: 'clean' });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.$('#viewport svg')!.querySelectorAll('rect').length).toBeGreaterThan(0);
  });

  it('the style survives a re-render of the same board', async () => {
    openStyleMenu()[1].click();
    h.send({ type: 'render', spec: BOARD, generation: 2 });
    await new Promise((r) => setTimeout(r, 30));
    expect(h.$('#viewport svg')!.querySelectorAll('rect').length, 'the style reset on the next update').toBeGreaterThan(0);
  });
});

describe('the board is objects, not one flat picture', () => {
  const pointerOn = (target: EventTarget, type: string, x: number, y: number) => {
    const e = new h.dom.window.Event(type, { bubbles: true }) as unknown as Record<string, unknown>;
    e.clientX = x; e.clientY = y; e.pointerId = 1; e.button = 0;
    target.dispatchEvent(e as unknown as Event);
  };

  it('every element the renderer drew is individually addressable', () => {
    const els = h.doc.querySelectorAll('#viewport svg [data-element-id]');
    expect(els.length, 'the board drew no addressable elements').toBeGreaterThan(1);
  });

  it('elements are marked draggable in Select mode', () => {
    const els = [...h.doc.querySelectorAll('#viewport svg [data-element-id]')];
    expect(els.every((e) => e.classList.contains('draggable'))).toBe(true);
  });

  it('dragging a node posts a move against its id', () => {
    const el = h.doc.querySelector('#viewport svg [data-element-id]') as SVGGElement;
    const id = el.getAttribute('data-element-id');
    pointerOn(el, 'pointerdown', 100, 100);
    pointerOn(el, 'pointermove', 160, 140);
    pointerOn(el, 'pointerup', 160, 140);
    const mv = h.posted.find((mm) => mm.type === 'moveElement');
    expect(mv, 'no move was recorded').toBeDefined();
    expect((mv as { targetId: string }).targetId).toBe(id);
  });

  it('a click without movement is not a move', () => {
    const el = h.doc.querySelector('#viewport svg [data-element-id]') as SVGGElement;
    pointerOn(el, 'pointerdown', 100, 100);
    pointerOn(el, 'pointerup', 100, 100);
    expect(h.posted.some((mm) => mm.type === 'moveElement'), 'a plain click moved the node').toBe(false);
  });

  it('the Hand tool exists, so a full board can still be panned', () => {
    // Every drag on a busy board was grabbing an element, because there is
    // almost no empty canvas left to start a pan from.
    const hand = h.btn('Pan the board');
    expect(hand).not.toBeNull();
    hand.click();
    expect((h.$('#canvas') as HTMLElement).dataset.tool).toBe('hand');
    expect(hand.getAttribute('aria-pressed')).toBe('true');
    expect(h.btn('Select').getAttribute('aria-pressed')).toBe('false');
  });

  it('the Hand tool does not move elements', () => {
    h.btn('Pan the board').click();
    const el = h.doc.querySelector('#viewport svg [data-element-id]') as SVGGElement;
    pointerOn(el, 'pointerdown', 100, 100);
    pointerOn(el, 'pointermove', 160, 140);
    pointerOn(el, 'pointerup', 160, 140);
    expect(h.posted.some((mm) => mm.type === 'moveElement'), 'the hand tool moved an element').toBe(false);
  });

  it('a tool being armed disables dragging', () => {
    h.btn('Pen').click();
    const el = h.doc.querySelector('#viewport svg [data-element-id]') as SVGGElement;
    pointerOn(el, 'pointerdown', 100, 100);
    pointerOn(el, 'pointermove', 160, 140);
    pointerOn(el, 'pointerup', 160, 140);
    expect(h.posted.some((mm) => mm.type === 'moveElement'), 'the board moved while the pen was out').toBe(false);
  });

  it('a pen stroke becomes its own movable object', async () => {
    h.send({
      type: 'feedbackState',
      data: {
        answers: [], stickies: [], moves: [],
        drawings: [{ id: 'd-1', at: new Date().toISOString(), points: [[0, 0], [40, 40]], boardTitle: 'harness board' }]
      }
    });
    await new Promise((r) => setTimeout(r, 20));
    const g = h.doc.querySelector('[data-mark-id="d-1"]') as SVGGElement;
    expect(g, 'the stroke was not drawn as its own object').not.toBeNull();
    expect(g.classList.contains('draggable'), 'the stroke is not movable').toBe(true);
    // a fat transparent copy makes a 2px line grabbable
    expect(g.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
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
    expect(h.btn('Questions from your agent').hidden).toBe(false);
  });

  it('drops a superseded render', async () => {
    h.send({ type: 'render', spec: { ...BOARD, title: 'newer' }, generation: 9 });
    await new Promise((r) => setTimeout(r, 20));
    h.send({ type: 'render', spec: { ...BOARD, title: 'stale' }, generation: 2 });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.$('#title')!.textContent).toBe('newer');
  });
});
