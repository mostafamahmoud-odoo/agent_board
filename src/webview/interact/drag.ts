import type { WebviewToHost } from '../../shared/protocol.js';
import type { PlacedElement } from '../layout/types.js';
import type { Viewport } from './viewport.js';

/**
 * Makes the board's contents individual objects you can pick up, rather than
 * one flat picture.
 *
 * Claude still owns the layout — positions come from `layout()` — but a drag
 * records an OFFSET against the element's id, which layout applies on the next
 * render. So a rearrangement survives Claude rewriting the board, and edges,
 * annotations and bounds all follow the moved node instead of pointing at
 * where it used to be.
 *
 * Only active in Select mode: while the pen or note tool is armed, a drag on
 * the board should draw or place, not move.
 */
export interface Draggable {
  /** The id a move is recorded against. */
  id: string;
  /** The group the renderer drew. */
  g: SVGGElement;
  /** Offset already applied, so a second drag is relative to where it sits. */
  base: { dx: number; dy: number };
}

const DRAG_THRESHOLD = 3;

export class DragController {
  private items = new Map<string, Draggable>();
  private active: Draggable | null = null;
  private startX = 0;
  private startY = 0;
  private moved = false;
  private enabled = true;

  constructor(
    private readonly viewport: Viewport,
    private readonly post: (m: WebviewToHost) => void,
    private readonly announce: (t: string) => void,
    private readonly kindOf: (id: string) => 'element' | 'mark'
  ) {}

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  reset(): void {
    this.items.clear();
    this.active = null;
  }

  /** Registers a rendered group as movable. */
  register(g: SVGGElement, id: string, base: { dx: number; dy: number }): void {
    const item: Draggable = { id, g, base };
    this.items.set(id, item);
    g.classList.add('draggable');

    g.addEventListener('pointerdown', (ev) => {
      if (!this.enabled) return;
      if (ev.button !== 0) return;
      ev.stopPropagation(); // do not let the board start panning
      this.active = item;
      this.moved = false;
      const [bx, by] = this.viewport.toBoard(ev.clientX, ev.clientY);
      this.startX = bx;
      this.startY = by;
      try {
        g.setPointerCapture(ev.pointerId);
      } catch {
        /* best effort */
      }
    });

    g.addEventListener('pointermove', (ev) => {
      if (this.active !== item) return;
      const [bx, by] = this.viewport.toBoard(ev.clientX, ev.clientY);
      const dx = bx - this.startX;
      const dy = by - this.startY;
      if (!this.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      this.moved = true;
      g.classList.add('dragging');
      // Live feedback is a transform; the durable offset is written on drop.
      g.setAttribute('transform', `translate(${dx},${dy})`);
    });

    const drop = (ev: PointerEvent) => {
      if (this.active !== item) return;
      try {
        g.releasePointerCapture(ev.pointerId);
      } catch {
        /* best effort */
      }
      g.classList.remove('dragging');
      this.active = null;
      if (!this.moved) return;

      const [bx, by] = this.viewport.toBoard(ev.clientX, ev.clientY);
      const dx = Math.round(bx - this.startX);
      const dy = Math.round(by - this.startY);
      g.removeAttribute('transform');

      if (this.kindOf(id) === 'mark') {
        this.post({ type: 'updateMark', id, patch: { dx, dy } });
      } else {
        this.post({ type: 'moveElement', targetId: id, dx: item.base.dx + dx, dy: item.base.dy + dy });
      }
      this.announce('Moved.');
    };
    g.addEventListener('pointerup', drop);
    g.addEventListener('pointercancel', drop);
  }

  /** Keyboard move for the focused element (FR-026). */
  nudge(el: PlacedElement | undefined, dx: number, dy: number): boolean {
    if (!el) return false;
    const item = this.items.get(el.id);
    if (!item) return false;
    this.post({
      type: 'moveElement',
      targetId: el.id,
      dx: item.base.dx + dx,
      dy: item.base.dy + dy
    });
    return true;
  }

  /** Clears every offset on the current board. */
  resetPositions(ids: string[]): void {
    for (const id of ids) this.post({ type: 'moveElement', targetId: id, dx: 0, dy: 0 });
    this.announce('Layout reset.');
  }
}
