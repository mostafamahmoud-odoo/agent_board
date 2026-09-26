import type { FeedbackLog, Sticky } from '../../shared/types.js';
import type { WebviewToHost } from '../../shared/protocol.js';
import type { Palette } from '../theme/palette.js';
import { el, polyline } from '../render/svg.js';
import type { Viewport } from './viewport.js';

/**
 * Pen strokes and sticky notes — the marks the user leaves on the board.
 *
 * Three behaviours this module gets right that the first version did not:
 *
 * 1. The pen returns to pan when the stroke ends. It used to stay armed until
 *    the button was pressed again, so the next click anywhere started drawing.
 * 2. A note stays editable. `commit()` used to set `readOnly = true` for good,
 *    and restored notes were read-only from birth, so a note could be created
 *    exactly once and never corrected.
 * 3. A note can be moved, and editing it UPDATES it. Marks now carry the id
 *    the host assigned, so an edit patches the entry instead of appending a
 *    second copy of the same note.
 */

export type Mode = 'pan' | 'pen' | 'note';

const NOTE_W = 190;
const NOTE_H = 108;

/** Ramer-Douglas-Peucker: keeps the shape, drops the redundant samples. */
export function decimate(points: [number, number][], epsilon = 1.6): [number, number][] {
  if (points.length <= 2) return points.slice();
  let maxDist = 0;
  let index = 0;
  const [first] = points;
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= epsilon) return [first, last];
  const left = decimate(points.slice(0, index + 1), epsilon);
  const right = decimate(points.slice(index), epsilon);
  return left.slice(0, -1).concat(right);
}

function perpendicularDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

export class Marks {
  private mode: Mode = 'pan';
  private stroke: [number, number][] = [];
  private active: SVGPathElement | null = null;
  /** Set while a note is open, so a state refresh cannot wipe it mid-sentence. */
  private busy = false;

  constructor(
    private readonly overlay: SVGSVGElement,
    /** The overlay's transformed group — marks go in here, in BOARD coords. */
    private readonly group: () => SVGGElement,
    private readonly viewport: Viewport,
    private readonly post: (m: WebviewToHost) => void,
    private readonly announce: (t: string) => void,
    private palette: Palette,
    /** Lets the toolbar follow a mode change the pen makes by itself. */
    private readonly onModeChange: (m: Mode) => void = () => {}
  ) {
    this.attach();
  }

  setPalette(p: Palette): void {
    this.palette = p;
  }

  getMode(): Mode {
    return this.mode;
  }

  setMode(next: Mode): Mode {
    this.mode = this.mode === next ? 'pan' : next;
    this.applyPointerEvents();
    this.announce(
      this.mode === 'pen'
        ? 'Pen mode. Drag on the board to draw one stroke.'
        : this.mode === 'note'
          ? 'Note mode. Click the board to place a note.'
          : 'Pan mode.'
    );
    this.onModeChange(this.mode);
    return this.mode;
  }

  private toPan(): void {
    if (this.mode === 'pan') return;
    this.mode = 'pan';
    this.applyPointerEvents();
    this.onModeChange('pan');
  }

  private applyPointerEvents(): void {
    // In pan mode the overlay must not swallow board gestures, but existing
    // notes stay interactive because each one re-enables pointer events on
    // itself.
    this.overlay.style.pointerEvents = this.mode === 'pan' ? 'none' : 'auto';
    this.overlay.style.cursor = this.mode === 'pen' ? 'crosshair' : this.mode === 'note' ? 'copy' : '';
  }

  /** Draws only the marks belonging to this board. */
  restore(log: FeedbackLog, boardTitle: string | undefined): void {
    if (this.busy) return; // never yank a note out from under someone typing
    this.group().replaceChildren();
    const mine = (t: string | undefined) => t == null || t === boardTitle;
    for (const d of log.drawings) {
      if (!mine(d.boardTitle) || !d.points?.length) continue;
      polyline(this.group(), d.points, { stroke: d.color || this.palette.pen, strokeWidth: 2.4 });
    }
    for (const s of log.stickies) {
      if (!mine(s.boardTitle)) continue;
      this.placeSticky({ id: s.id, x: s.x, y: s.y, text: s.text, editing: false });
    }
  }

  private attach(): void {
    this.overlay.addEventListener('pointerdown', (ev) => {
      if (this.mode === 'pen') {
        const [x, y] = this.viewport.toBoard(ev.clientX, ev.clientY);
        this.stroke = [[x, y]];
        this.active = polyline(this.group(), this.stroke, { stroke: this.palette.pen, strokeWidth: 2.4 });
        try {
          this.overlay.setPointerCapture(ev.pointerId);
        } catch {
          /* capture is best-effort */
        }
      } else if (this.mode === 'note') {
        const [x, y] = this.viewport.toBoard(ev.clientX, ev.clientY);
        this.toPan();
        this.placeSticky({ x: x - NOTE_W / 2, y: y - 16, text: '', editing: true });
      }
    });

    this.overlay.addEventListener('pointermove', (ev) => {
      if (this.mode !== 'pen' || !this.active) return;
      const [x, y] = this.viewport.toBoard(ev.clientX, ev.clientY);
      const last = this.stroke[this.stroke.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) < 1.2) return;
      this.stroke.push([x, y]);
      this.active.setAttribute('d', this.stroke.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' '));
    });

    const finish = (ev: PointerEvent) => {
      if (!this.active) return;
      try {
        this.overlay.releasePointerCapture(ev.pointerId);
      } catch {
        /* capture may already be gone */
      }
      const points = decimate(this.stroke);
      if (points.length >= 2) {
        this.post({ type: 'feedback', kind: 'drawing', payload: { color: this.palette.pen, points } });
        this.announce('Drawing saved.');
      } else {
        this.active.remove();
      }
      this.active = null;
      this.stroke = [];
      // One stroke per activation: leaving the pen armed meant the next click
      // anywhere on the board started drawing again.
      this.toPan();
    };
    this.overlay.addEventListener('pointerup', finish);
    this.overlay.addEventListener('pointercancel', finish);
  }

  placeSticky(o: { id?: string; x: number; y: number; text: string; editing: boolean }): void {
    const fo = el('foreignObject');
    fo.setAttribute('x', String(o.x));
    fo.setAttribute('y', String(o.y));
    fo.setAttribute('width', String(NOTE_W));
    fo.setAttribute('height', String(NOTE_H));
    fo.setAttribute('class', 'sticky-fo');
    // Always interactive, whatever the board mode is — otherwise an existing
    // note becomes unreachable the moment you leave note mode.
    fo.style.pointerEvents = 'auto';
    if (o.id) fo.setAttribute('data-mark-id', o.id);

    const wrap = document.createElement('div');
    wrap.className = 'sticky';
    wrap.style.background = this.palette.sticky.fill;
    wrap.style.color = this.palette.sticky.text;

    const grip = document.createElement('div');
    grip.className = 'sticky-grip';
    grip.title = 'Drag to move';
    grip.setAttribute('aria-hidden', 'true');

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sticky-del';
    del.textContent = '×';
    del.title = 'Delete this note';
    del.setAttribute('aria-label', 'Delete this note');

    const ta = document.createElement('textarea');
    ta.className = 'sticky-note';
    ta.value = o.text;
    ta.setAttribute('aria-label', 'Sticky note');
    ta.placeholder = 'Type a note…';

    let x = o.x;
    let y = o.y;
    let id = o.id;

    const save = () => {
      const text = ta.value.trim();
      if (!text) {
        // An empty note is a mis-click, not content.
        fo.remove();
        if (id) this.post({ type: 'deleteMark', id });
        return;
      }
      if (id) this.post({ type: 'updateMark', id, patch: { x, y, text } });
      else this.post({ type: 'feedback', kind: 'sticky', payload: { x, y, text } });
      this.announce('Note saved.');
    };

    const beginEdit = () => {
      this.busy = true;
      wrap.classList.add('editing');
      ta.readOnly = false;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    };

    const endEdit = () => {
      if (!this.busy) return;
      this.busy = false;
      wrap.classList.remove('editing');
      ta.readOnly = true;
      save();
    };

    ta.readOnly = !o.editing;
    ta.addEventListener('blur', endEdit);
    ta.addEventListener('dblclick', beginEdit);
    // A single click is enough: a read-only textarea gives no other affordance.
    ta.addEventListener('pointerdown', (e) => {
      if (ta.readOnly) {
        e.stopPropagation();
        beginEdit();
      }
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        ta.blur();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        ta.blur();
      }
      e.stopPropagation(); // board shortcuts must not fire while typing
    });

    del.addEventListener('click', (e) => {
      e.stopPropagation();
      this.busy = false;
      fo.remove();
      if (id) this.post({ type: 'deleteMark', id });
      this.announce('Note deleted.');
    });

    // ---- drag ----
    let dragging = false;
    let ox = 0;
    let oy = 0;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const [bx, by] = this.viewport.toBoard(e.clientX, e.clientY);
      dragging = true;
      ox = bx - x;
      oy = by - y;
      this.busy = true;
      wrap.classList.add('dragging');
      try {
        grip.setPointerCapture(e.pointerId);
      } catch {
        /* best effort */
      }
    });
    grip.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const [bx, by] = this.viewport.toBoard(e.clientX, e.clientY);
      x = Math.round(bx - ox);
      y = Math.round(by - oy);
      fo.setAttribute('x', String(x));
      fo.setAttribute('y', String(y));
    });
    const dropped = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      this.busy = false;
      wrap.classList.remove('dragging');
      try {
        grip.releasePointerCapture(e.pointerId);
      } catch {
        /* best effort */
      }
      if (id) this.post({ type: 'updateMark', id, patch: { x, y } });
      else if (ta.value.trim()) save();
      this.announce('Note moved.');
    };
    grip.addEventListener('pointerup', dropped);
    grip.addEventListener('pointercancel', dropped);

    // Keyboard move: a note must be placeable without a pointer (FR-028).
    grip.tabIndex = 0;
    grip.setAttribute('role', 'button');
    grip.setAttribute('aria-label', 'Move this note with the arrow keys');
    grip.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 20 : 4;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step]
      };
      const d = moves[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      x += d[0];
      y += d[1];
      fo.setAttribute('x', String(x));
      fo.setAttribute('y', String(y));
      if (id) this.post({ type: 'updateMark', id, patch: { x, y } });
    });

    wrap.append(grip, del, ta);
    fo.appendChild(wrap);
    this.group().appendChild(fo);

    if (o.editing) {
      this.busy = true;
      setTimeout(() => beginEdit(), 0);
    }

    // Once the host assigns an id, adopt it so later edits patch rather than
    // append. The next feedbackState redraw carries it.
    void (id as string | undefined);
  }

  /** Places a note at the centre of the current view — the keyboard path. */
  placeCentreSticky(): void {
    const r = this.overlay.getBoundingClientRect();
    const [x, y] = this.viewport.toBoard(r.left + r.width / 2, r.top + r.height / 2);
    this.toPan();
    this.placeSticky({ x: x - NOTE_W / 2, y: y - 16, text: '', editing: true });
  }

  clear(): void {
    this.busy = false;
    this.group().replaceChildren();
  }
}

export type { Sticky };
