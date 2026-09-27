import './styles.css';

import type { BoardSpec, FeedbackLog, LibraryEntry, MoveMap, RenderStyle, Warning } from '../shared/types.js';
import { isMessage, type HostToWebview, type WebviewToHost } from '../shared/protocol.js';
import { layout } from './layout/layout.js';
import type { LayoutResult } from './layout/types.js';
import { createCanvasMeasurer } from './measure/text.js';
import { buildPalette, type Palette } from './theme/palette.js';
import { observeTheme, readSignals } from './theme/tokens.js';
import { sketchyRenderer } from './render/sketchy.js';
import { cleanRenderer } from './render/clean.js';
import { boardToMermaid, canRenderAsMermaid } from './render/to-mermaid.js';
import { DrawioCanvas, resolveEmbedUrl } from './render/drawio.js';
import type { Renderer } from './render/renderer.js';
import { describe } from './a11y/describe.js';
import { announce, mountAnnouncer } from './a11y/announce.js';
import { BoardFocus } from './a11y/focus.js';
import { Viewport } from './interact/viewport.js';
import { Marks, type Mode } from './interact/marks.js';
import { DragController } from './interact/drag.js';
import { buildToolbar, closeMenu, openMenu } from './ui/toolbar.js';
import { SVG_NS } from './render/svg.js';
import { MARGIN } from './render/renderer.js';

const vscode = acquireVsCodeApi();
const measurer = createCanvasMeasurer();
const focusModel = new BoardFocus();

interface Persisted {
  style?: RenderStyle;
  drawioXml?: string;
  drawioForTitle?: string;
  viewport?: { scale: number; tx: number; ty: number };
  boardTitle?: string;
}

const post = (m: WebviewToHost) => vscode.postMessage(m);
const saved = (vscode.getState() as Persisted | undefined) ?? {};

let spec: BoardSpec | null = null;
let result: LayoutResult | null = null;
let palette: Palette = buildPalette(readSignals().kind);
let style: RenderStyle = saved.style ?? 'drawio';
let highestGeneration = -1;
let lastTitle: string | null = null;
let mermaidRenderer: { renderAsync(spec: BoardSpec, p: Palette): Promise<SVGSVGElement> } | null = null;
let library: LibraryEntry[] = [];
let feedback: FeedbackLog = { answers: [], drawings: [], stickies: [] };
let viewingSaved: string | null = null;
let forcedReducedMotion = false;
/** True once the user chooses a style, which then wins over the board's own. */
let userPickedStyle = false;
let drawio: DrawioCanvas | null = null;
/** The user's draw.io edits, kept per board so a redraw does not lose them. */
let drawioXml: string | null = null;
let drawioForTitle: string | null = null;

/** Offsets for anything the user has dragged on this board. */
function moveMap(): MoveMap {
  const out: MoveMap = {};
  for (const mv of feedback.moves || []) {
    if (mv.boardTitle != null && mv.boardTitle !== spec?.title) continue;
    out[mv.targetId] = { dx: mv.dx, dy: mv.dy };
  }
  return out;
}

/* ------------------------------------------------------------------ DOM */

const app = document.getElementById('app') as HTMLElement;
app.innerHTML = '';

const parts = buildToolbar();
const bar = parts.bar;
const viewbar = parts.viewbar;
const menu = parts.menu;
const titleEl = () => document.getElementById('title') as HTMLElement;
const folderEl = () => document.getElementById('folder') as HTMLElement;
const zoomVal = () => document.getElementById('zoomval') as HTMLElement;
const qBtn = parts.questionsBtn;

const canvas = div('canvas');
canvas.id = 'canvas';
canvas.setAttribute('role', 'group');
canvas.setAttribute('aria-label', 'Board');
const inner = div('viewport');
inner.id = 'viewport';
canvas.appendChild(inner);

const overlay = document.createElementNS(SVG_NS, 'svg');
overlay.id = 'overlay';
overlay.setAttribute('aria-hidden', 'true');
overlay.setAttribute('overflow', 'visible');
inner.appendChild(overlay);

const description = document.createElement('div');
description.id = 'description';
description.className = 'visually-hidden';
description.setAttribute('aria-live', 'off');

const banner = div('banner');
banner.id = 'banner';
banner.hidden = true;

const qPanel = div('panel');
qPanel.id = 'qpanel';
qPanel.hidden = true;
qPanel.setAttribute('role', 'dialog');
qPanel.setAttribute('aria-label', 'Questions');

const libPanel = div('panel');
libPanel.id = 'librarypanel';
libPanel.hidden = true;
libPanel.setAttribute('role', 'dialog');
libPanel.setAttribute('aria-label', 'Board library');

app.append(bar, viewbar, canvas, description, banner, qPanel, libPanel, menu);
mountAnnouncer(app);

let marks: Marks;

const viewport = new Viewport(canvas, inner, () => {
  vscode.setState({ ...(vscode.getState() as Persisted), viewport: viewport.state, style, boardTitle: spec?.title });
  const z = zoomVal();
  if (z) z.textContent = `${Math.round(viewport.state.scale * 100)}%`;
});

const drag = new DragController(
  viewport,
  post,
  announce,
  (id) => (result?.byId[id] ? 'element' : 'mark')
);

marks = new Marks(
  canvas,
  overlay,
  () => overlayGroup(),
  viewport,
  post,
  announce,
  palette,
  (m) => applyMode(m),
  (g, id) => drag.register(g, id, { dx: 0, dy: 0 })
);

/* -------------------------------------------------------------- helpers */

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
function button(label: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  return b;
}

function showBanner(
  kind: 'error' | 'warn' | 'info',
  text: string,
  detail?: string,
  actions: { label: string; title: string; run: () => void }[] = []
): void {
  banner.className = `banner ${kind}`;
  banner.hidden = false;
  banner.replaceChildren();
  const body = document.createElement('div');
  const p = document.createElement('div');
  p.textContent = text;
  body.appendChild(p);
  if (detail) {
    const pre = document.createElement('pre');
    pre.textContent = detail;
    body.appendChild(pre);
  }
  banner.appendChild(body);
  for (const a of actions) {
    const b = button(a.label, a.title);
    b.className = 'primary';
    b.onclick = a.run;
    banner.appendChild(b);
  }
  const close = button('Dismiss', 'Dismiss this message');
  close.onclick = () => {
    banner.hidden = true;
  };
  banner.appendChild(close);
  announce(text, kind === 'error');
}

function warningText(ws: Warning[]): string {
  return ws.map((w) => `${w.path ? w.path + ': ' : ''}${w.message}`).join('\n');
}

/* --------------------------------------------------------------- render */

/**
 * Aligns the mark overlay with the board it sits on.
 *
 * The renderer translates its group by (margin - minX, margin - minY); the
 * overlay has to apply the same shift, or a mark recorded in board
 * coordinates lands somewhere else entirely.
 */
function syncOverlay(svg: SVGSVGElement, bounds: { minX: number; minY: number }): void {
  const w = svg.getAttribute('width') || '0';
  const h = svg.getAttribute('height') || '0';
  overlay.setAttribute('width', w);
  overlay.setAttribute('height', h);
  overlay.style.width = `${w}px`;
  overlay.style.height = `${h}px`;
  const g = overlayGroup();
  g.setAttribute('transform', `translate(${MARGIN - bounds.minX},${MARGIN - bounds.minY})`);
}

/** The overlay's single transformed group; marks are drawn into it. */
function overlayGroup(): SVGGElement {
  let g = overlay.querySelector('g') as SVGGElement | null;
  if (!g) {
    g = document.createElementNS(SVG_NS, 'g');
    overlay.appendChild(g);
  }
  return g;
}

function rendererFor(s: RenderStyle): Renderer {
  return s === 'clean' ? cleanRenderer : sketchyRenderer;
}

async function draw(): Promise<void> {
  if (!spec) return;
  const signals = readSignals();
  palette = buildPalette(signals.kind);
  marks.setPalette(palette);
  viewport.setReduceMotion(forcedReducedMotion || signals.reduceMotion);

  /*
   * A board may ASK for a style; the toolbar overrides it for the session.
   * Only mermaid used to be honoured from the spec, so a board declaring
   * `style: "drawio"` silently rendered as sketchy.
   */
  const asked = spec.style;
  const effective: RenderStyle =
    asked === 'mermaid'
      ? 'mermaid' // a mermaid board cannot be drawn any other way
      : userPickedStyle
        ? style
        : (asked ?? style);

  inner.replaceChildren();
  focusModel.reset();

  if (effective === 'drawio') {
    inner.replaceChildren();
    overlay.remove();
    result = layout(spec, measurer, moveMap());
    description.textContent = describe(result, spec);

    if (!drawio) {
      const url = resolveEmbedUrl(document.body.dataset.drawioUrl, palette.kind !== 'light' && palette.kind !== 'high-contrast-light');
      /*
       * MOUNTED ON <body>, NOT ON #viewport.
       *
       * #viewport carries the pan/zoom transform and `will-change: transform`,
       * and either of those makes it the containing block for a
       * position:fixed descendant. So `#drawio { position: fixed; inset: 0 }`
       * sized itself against #viewport — which replaceChildren() had just
       * emptied, and whose only child was then out-of-flow, so it measured
       * 0x0. The iframe loaded, handshook and painted at zero size: exactly
       * the "draw.io doesn't load" and the blank captures.
       */
      drawio = new DrawioCanvas(document.body, url, {
        onEdit: (xml) => {
          // The user's version of this board. Kept in webview state so a
          // theme change or a redraw does not throw their work away.
          drawioXml = xml;
          drawioForTitle = spec?.title ?? null;
          vscode.setState({ ...(vscode.getState() as Persisted), drawioXml, drawioForTitle });
        },
        onReady: () => announce('draw.io canvas ready.'),
        onError: (m) => showBanner('error', 'The draw.io canvas reported a problem.', m)
      });
      drawio.mount();
    }

    // Reopen the user's edited version of THIS board; otherwise start from
    // the board Claude drew.
    const sketch = document.body.dataset.drawioSketch !== 'false';
    if (drawioXml && drawioForTitle === spec.title) drawio.loadXml(drawioXml);
    else drawio.load(result, spec, palette, sketch);

    titleEl().textContent = spec.title || 'Claude Notes';
    banner.hidden = true;
    renderQuestions();
    return;
  }

  if (drawio) {
    drawio.dispose();
    drawio = null;
    if (!overlay.isConnected) inner.appendChild(overlay);
  }

  if (effective === 'mermaid') {
    // Loaded ONLY when a board actually needs it: the prototype pulled 3.3 MB
    // synchronously on every panel open, before anything else could run.
    try {
      if (!mermaidRenderer) {
        const mod = await import('./render/mermaid.js');
        mermaidRenderer = mod.createMermaidRenderer();
      }
      // A board made of nodes and frames has no `code`; derive it, so
      // choosing Mermaid means "the same board, laid out by mermaid" rather
      // than a dead end.
      let source = spec;
      if (!(typeof spec.code === 'string' && spec.code.trim())) {
        const derived = boardToMermaid(spec);
        source = { ...spec, code: derived.code };
        if (derived.warnings.length) {
          showBanner('info', 'Shown as a mermaid flowchart.', derived.warnings.join('\n'));
        } else {
          banner.hidden = true;
        }
      }
      const svg = await mermaidRenderer.renderAsync(source, palette);
      inner.appendChild(svg);
    } catch (e) {
      showBanner('error', 'The mermaid diagram could not be rendered.', String((e as Error).message ?? e));
      return;
    }
  } else {
    result = layout(spec, measurer, moveMap());
    const offsets = moveMap();
    drag.reset();
    const svg = rendererFor(effective).render(result, palette, {
      onElement: (g, el) => {
        focusModel.register(g, el, result!);
        drag.register(g, el.id, offsets[el.id] ?? { dx: 0, dy: 0 });
      }
    });
    svg.setAttribute('role', 'graphics-document');
    svg.setAttribute('aria-label', `Board: ${spec.title}`);
    svg.setAttribute('aria-describedby', 'description');
    inner.appendChild(svg);
    inner.appendChild(overlay);
    syncOverlay(svg, result.bounds);

    description.textContent = describe(result, spec);

    if (result.warnings.length) {
      showBanner(
        'warn',
        `This board has ${result.warnings.length} problem${result.warnings.length === 1 ? '' : 's'}; the rest of it still drew.`,
        warningText(result.warnings)
      );
    } else {
      banner.hidden = true;
    }
  }

  titleEl().textContent = spec.title || 'Claude Notes';
  parts.styleBtn.disabled = spec.style === 'mermaid';
  parts.styleBtn.title = spec.style === 'mermaid' ? 'This board is a mermaid diagram' : `Render style: ${effective}`;

  // Only re-fit when the board is genuinely new; growing a board under one
  // title must not yank the view the user has set.
  if (spec.title !== lastTitle) {
    lastTitle = spec.title;
    userPickedStyle = false;
    viewport.fit();
  } else if (saved.viewport && saved.boardTitle === spec.title) {
    viewport.restore(saved.viewport);
  }
  renderQuestions();
  marks.restore(feedback, spec.title);
}

/* ------------------------------------------------------------ questions */

function renderQuestions(): void {
  const qs = spec?.questions ?? [];
  qBtn.hidden = qs.length === 0;
  if (!qs.length) {
    qPanel.hidden = true;
    qBtn.setAttribute('aria-expanded', 'false');
    return;
  }
  const answered = new Set(feedback.answers.map((a) => a.questionId));
  qPanel.replaceChildren();
  const h = document.createElement('h2');
  h.textContent = 'Questions on this board';
  qPanel.appendChild(h);

  for (const q of qs) {
    const wrap = div('q');
    const p = document.createElement('p');
    p.textContent = q.text;
    wrap.appendChild(p);

    if (answered.has(q.id)) {
      const done = document.createElement('div');
      done.className = 'answered';
      done.textContent = 'answered — waiting for Claude to read it';
      wrap.appendChild(done);
    } else {
      const ta = document.createElement('textarea');
      ta.setAttribute('aria-label', q.text);
      const send = button('Send', 'Save this answer (Ctrl+Enter)');
      send.className = 'primary';
      const submit = () => {
        const text = ta.value.trim();
        if (!text) return;
        post({ type: 'feedback', kind: 'answer', payload: { questionId: q.id, question: q.text, text } });
        announce('Answer saved.');
      };
      send.onclick = submit;
      ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      });
      wrap.append(ta, send);
    }
    qPanel.appendChild(wrap);
  }
}

/* -------------------------------------------------------------- library */

function renderLibrary(): void {
  libPanel.replaceChildren();
  const h = document.createElement('h2');
  h.textContent = 'Saved boards';
  libPanel.appendChild(h);

  if (!library.length) {
    const p = document.createElement('p');
    p.textContent = 'Nothing saved yet.';
    libPanel.appendChild(p);
    return;
  }

  for (const it of library) {
    const row = div('lib-item');
    const t = document.createElement('span');
    t.className = 'lib-title';
    t.textContent = it.title;
    const when = document.createElement('span');
    when.className = 'lib-when';
    when.textContent = new Date(it.savedAt).toLocaleString();
    const view = button('View', `Open "${it.title}" read-only`);
    view.onclick = () => post({ type: 'loadFromLibrary', file: it.file });
    const resume = button('Resume', `Make "${it.title}" the live board again`);
    resume.onclick = () => post({ type: 'resumeLive', file: it.file });
    const mention = button('Copy mention', 'Copy a "continue from this note" line');
    mention.onclick = () => post({ type: 'copyMention', file: it.file, title: it.title });
    row.append(t, when, view, resume, mention);
    libPanel.appendChild(row);
  }
}

function applyMode(m: Mode): void {
  // While a tool is armed a drag on the board must draw or place, not move.
  drag.setEnabled(m === 'select');
  for (const [name, b] of Object.entries(parts.tools)) {
    const on = name === m;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('active', on);
  }
}

function toggle(panel: HTMLElement, btn: HTMLButtonElement): void {
  const open = panel.hidden;
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) {
    (panel.querySelector('textarea, button') as HTMLElement | null)?.focus();
  } else {
    btn.focus();
  }
}

/* --------------------------------------------------------------- wiring */

function setStyle(next: RenderStyle): void {
  style = next;
  userPickedStyle = true;
  vscode.setState({ ...(vscode.getState() as Persisted), style });
  post({ type: 'styleChanged', style });
  void draw();
  announce(`Render style: ${style}.`);
}

parts.styleBtn.onclick = () => {
  if (!menu.hidden) return closeMenu(menu);
  const isMermaidBoard = typeof spec?.code === 'string' && spec.code.trim().length > 0;
  const available: RenderStyle[] = isMermaidBoard
    ? ['mermaid'] // nothing else can draw a board that is only mermaid source
    : canRenderAsMermaid(spec)
      ? ['sketchy', 'clean', 'mermaid', 'drawio']
      : ['sketchy', 'clean', 'drawio'];
  openMenu(
    menu,
    parts.styleBtn,
    available.map((v) => ({
      label:
        v === 'sketchy'
          ? 'Sketchy — hand-drawn'
          : v === 'clean'
            ? 'Clean — for sharing'
            : v === 'mermaid'
              ? 'Mermaid — auto-laid out'
              : 'draw.io — full editing canvas',
      checked: (isMermaidBoard ? 'mermaid' : style) === v,
      run: () => setStyle(v)
    }))
  );
};

parts.boardBtn.onclick = () => {
  if (!menu.hidden) return closeMenu(menu);
  openMenu(menu, parts.boardBtn, [
    { label: 'Browse saved boards…', run: () => { post({ type: 'listLibrary' }); toggle(libPanel, parts.boardBtn); } },
    { label: 'Save this board', run: () => post({ type: 'saveBoard' }) },
    { label: 'Copy board as text', run: () => post({ type: 'description', text: description.textContent || '' }) },
    { label: 'Clear my marks', run: () => { post({ type: 'clearFeedback' }); marks.clear(); announce('Marks cleared.'); } }
  ]);
};

parts.zoomBtn.onclick = () => {
  if (!menu.hidden) return closeMenu(menu);
  openMenu(menu, parts.zoomBtn, [
    { label: 'Fit to panel', hint: 'F', run: () => viewport.fit() },
    { label: 'Zoom to 100%', hint: '0', run: () => viewport.reset() },
    { label: 'Zoom in', hint: '+', run: () => viewport.zoom(1.25) },
    { label: 'Zoom out', hint: '-', run: () => viewport.zoom(1 / 1.25) }
  ]);
};

parts.panelBtn.onclick = () => {
  const on = description.classList.toggle('shown');
  parts.panelBtn.setAttribute('aria-expanded', String(on));
  parts.panelBtn.setAttribute('aria-pressed', String(on));
};

for (const [name, b] of Object.entries(parts.tools)) {
  b.onclick = () => applyMode(marks.setMode(name as Mode));
}
qBtn.onclick = () => toggle(qPanel, qBtn);

document.addEventListener('pointerdown', (e) => {
  const t = e.target as Element | null;
  if (menu.hidden) return;
  if (t?.closest('#menu, #bar, #viewbar')) return;
  closeMenu(menu);
});

// Space = temporary Hand, released on keyup. Standard on every canvas, and
// the reliable way to move around a board with no empty space left.
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') viewport.setSpaceHeld(false);
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !(e.target as HTMLElement)?.matches?.('input, textarea')) {
    viewport.setSpaceHeld(true);
    e.preventDefault();
  }
  const inField = (e.target as HTMLElement)?.matches?.('input, textarea, select');
  if (e.key === 'Escape') {
    if (!menu.hidden) closeMenu(menu);
    else if (!qPanel.hidden) toggle(qPanel, qBtn);
    else if (!libPanel.hidden) toggle(libPanel, parts.boardBtn);
    else if (marks.getMode() !== 'select') applyMode(marks.setMode('select'));
    return;
  }
  if (inField) return;

  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown': {
      const step = e.shiftKey ? 20 : 4;
      const d: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]
      };
      const [nx, ny] = d[e.key];
      // A focused element moves; otherwise the arrows pan the board.
      const onEl = (document.activeElement as Element | null)?.closest?.('.board-el');
      if (onEl && drag.nudge(focusModel.current, nx, ny)) e.preventDefault();
      else { viewport.panBy(-nx * 10, -ny * 10); e.preventDefault(); }
      break;
    }
    case '+': case '=': viewport.zoom(1.15); e.preventDefault(); break;
    case '-': case '_': viewport.zoom(1 / 1.15); e.preventDefault(); break;
    case '0': viewport.reset(); e.preventDefault(); break;
    case 'f': case 'F': viewport.fit(); e.preventDefault(); break;
    case 'v': case 'V': applyMode(marks.setMode('select')); e.preventDefault(); break;
    case 'h': case 'H': applyMode(marks.setMode('hand')); e.preventDefault(); break;
    case 'p': case 'P': applyMode(marks.setMode('pen')); e.preventDefault(); break;
    case 'n': case 'N': {
      const m = marks.setMode('note');
      applyMode(m);
      if (m === 'note') marks.placeCentreSticky();
      e.preventDefault();
      break;
    }
    default: break;
  }
});

// Tab within the board moves between elements rather than leaving it.
canvas.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || !focusModel.count) return;
  const active = document.activeElement;
  if (!active?.closest?.('.board-el')) return;
  e.preventDefault();
  const el = focusModel.move(e.shiftKey ? -1 : 1);
  if (el && result) {
    viewport.revealBox(el.x, el.y, el.w, el.h);
    announce(describe(result, spec!).split('\n')[0] ? '' : '');
  }
});

observeTheme((s) => {
  palette = buildPalette(s.kind);
  marks.setPalette(palette);
  viewport.setReduceMotion(forcedReducedMotion || s.reduceMotion);
  // Redraw WITHOUT re-fitting: a theme change must not move the user's view.
  const keep = viewport.state;
  void draw().then(() => viewport.restore(keep));
});

/* ------------------------------------------------------------- messages */

window.addEventListener('message', (ev: MessageEvent) => {
  const msg = ev.data;
  if (!isMessage(msg)) return;
  const m = msg as HostToWebview;

  switch (m.type) {
    case 'render': {
      // Drop a superseded render: mermaid is awaited, so two close together
      // could otherwise interleave and the earlier overwrite the later.
      if (m.generation < highestGeneration) return;
      highestGeneration = m.generation;
      spec = m.spec;
      viewingSaved = m.viewingSaved ?? null;
      folderEl().textContent = m.watchedFolder ? `· ${m.watchedFolder}` : '';
      parts.boardBtn.title = m.watchedFolder
        ? `Only the first workspace folder is watched. Showing "${m.watchedFolder}".`
        : 'Board actions';
      if (viewingSaved) {
        showBanner('info', 'Viewing a saved board. Live updates are paused.', undefined, [
          { label: 'Back to live', title: 'Return to the board Claude is writing', run: () => post({ type: 'backToLive' }) },
          {
            label: 'Resume editing',
            title: 'Make this saved board the live one again',
            run: () => post({ type: 'resumeLive', file: viewingSaved! })
          }
        ]);
      }
      if (m.warnings?.length) showBanner('warn', 'This board has problems; the rest still drew.', warningText(m.warnings));
      void draw();
      return;
    }
    case 'error':
      showBanner('error', m.message, m.detail?.map((d) => `${d.path || '(root)'}: ${d.message}`).join('\n'));
      return;
    case 'clear':
      spec = null;
      result = null;
      lastTitle = null;
      inner.replaceChildren();
      description.textContent = '';
      banner.hidden = true;
      return;
    case 'feedbackState':
      feedback = m.data;
      marks.restore(feedback, spec?.title);
      renderQuestions();
      return;
    case 'library':
      library = m.items;
      renderLibrary();
      return;
    case 'liveUpdated':
      showBanner('info', 'The live board changed while you are viewing a saved one.', undefined, [
        { label: 'Show it', title: 'Switch to the live board', run: () => post({ type: 'backToLive' }) }
      ]);
      return;
    case 'themeChanged':
      palette = buildPalette(m.kind);
      marks.setPalette(palette);
      forcedReducedMotion = m.forceReducedMotion === true;
      viewport.setReduceMotion(forcedReducedMotion || readSignals().reduceMotion);
      void draw();
      return;
    case 'setStyle':
      if (m.style) {
        style = m.style;
        void draw();
      }
      return;
    case 'viewport':
      if (m.action === 'fit') viewport.fit();
      else if (m.action === 'resetZoom') viewport.reset();
      else post({ type: 'description', text: description.textContent || '' });
      return;
    default:
      return; // unknown type: ignore
  }
});

post({ type: 'ready' });
