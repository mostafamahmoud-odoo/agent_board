import type { FeedbackLog } from '../../shared/types.js';
import type { WebviewToHost } from '../../shared/protocol.js';
import type { Palette } from '../theme/palette.js';
import { el, polyline } from '../render/svg.js';
import type { Viewport } from './viewport.js';

/**
 * Pen strokes and sticky notes — the marks the user leaves on the board.
 *
 * Two fixes carried over from the prototype:
 *
 * 1. Strokes are DECIMATED before posting (FR-040). The old code pushed one
 *    point per pointermove, so a single long stroke could be thousands of
 *    points in a file that only ever grew.
 * 2. Only marks belonging to the CURRENT board are drawn. The old
 *    restoreFeedback redrew every historical stroke and sticky on every state
 *    update, so overlay node count tracked total session history.
 */

export type Mode = 'pan' | 'pen' | 'note';

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

  constructor(
    private readonly overlay: SVGSVGElement,
    private readonly viewport: Viewport,
    private readonly post: (m: WebviewToHost) => void,
    private readonly announce: (t: string) => void,
    private palette: Palette
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
    this.overlay.style.pointerEvents = this.mode === 'pan' ? 'none' : 'auto';
    this.announce(
      this.mode === 'pen'
        ? 'Pen mode. Drag on the board to draw.'
        : this.mode === 'note'
          ? 'Note mode. Click the board to place a note.'
          : 'Pan mode.'
    );
    return this.mode;
  }

  /** Draws only the marks belonging to this board. */
  restore(log: FeedbackLog, boardTitle: string | undefined): void {
    this.overlay.replaceChildren();
    const mine = (t: string | undefined) => t == null || t === boardTitle;
    for (const d of log.drawings) {
      if (!mine(d.boardTitle) || !d.points?.length) continue;
      polyline(this.overlay, d.points, { stroke: d.color || this.palette.pen, strokeWidth: 2.4 });
    }
    for (const s of log.stickies) {
      if (!mine(s.boardTitle)) continue;
      this.placeSticky(s.x, s.y, s.text, false);
    }
  }

  private attach(): void {
    this.overlay.addEventListener('pointerdown', (ev) => {
      if (this.mode === 'pen') {
        const [x, y] = this.viewport.toBoard(ev.clientX, ev.clientY);
        this.stroke = [[x, y]];
        this.active = polyline(this.overlay, this.stroke, { stroke: this.palette.pen, strokeWidth: 2.4 });
        this.overlay.setPointerCapture(ev.pointerId);
      } else if (this.mode === 'note') {
        const [x, y] = this.viewport.toBoard(ev.clientX, ev.clientY);
        this.placeSticky(x, y, '', true);
        this.setMode('note'); // toggles back to pan
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
      if (this.mode !== 'pen' || !this.active) return;
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
    };
    this.overlay.addEventListener('pointerup', finish);
    this.overlay.addEventListener('pointercancel', finish);
  }

  /** Keyboard path (FR-028): drop a note without a pointer. */
  placeSticky(x: number, y: number, initial: string, editing: boolean): void {
    const fo = el('foreignObject');
    fo.setAttribute('x', String(x));
    fo.setAttribute('y', String(y));
    fo.setAttribute('width', '190');
    fo.setAttribute('height', '104');
    fo.setAttribute('class', 'sticky-fo');
    fo.style.pointerEvents = 'auto';

    const ta = document.createElement('textarea');
    ta.className = 'sticky-note';
    ta.value = initial;
    ta.setAttribute('aria-label', 'Sticky note');
    ta.style.background = this.palette.sticky.fill;
    ta.style.color = this.palette.sticky.text;
    ta.readOnly = !editing;

    const commit = () => {
      const text = ta.value.trim();
      if (!text) {
        fo.remove();
        return;
      }
      ta.readOnly = true;
      this.post({ type: 'feedback', kind: 'sticky', payload: { x, y, text } });
      this.announce('Note saved.');
    };

    if (editing) {
      ta.addEventListener('blur', commit, { once: true });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          ta.value = '';
          ta.blur();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          ta.blur();
        }
      });
    }

    fo.appendChild(ta);
    this.overlay.appendChild(fo);
    if (editing) setTimeout(() => ta.focus(), 0);
  }

  /** Places a note at the centre of the current view — the keyboard path. */
  placeCentreSticky(): void {
    const r = this.overlay.getBoundingClientRect();
    const [x, y] = this.viewport.toBoard(r.left + r.width / 2, r.top + r.height / 2);
    this.placeSticky(x, y, '', true);
  }

  clear(): void {
    this.overlay.replaceChildren();
  }
}
