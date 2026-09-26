/**
 * Pan/zoom, operable by pointer AND keyboard (FR-026).
 *
 * The prototype was pointer/wheel only — the board had no tabindex and the
 * only key handlers in the whole file were inside two textareas.
 */

export interface ViewportState {
  scale: number;
  tx: number;
  ty: number;
}

export class Viewport {
  private scale = 1;
  private tx = 8;
  private ty = 8;
  private dragging = false;
  private sx = 0;
  private sy = 0;


  constructor(
    private readonly canvas: HTMLElement,
    private readonly inner: HTMLElement,
    private readonly onChange: () => void
  ) {
    this.attach();
  }

  setReduceMotion(v: boolean): void {
    this.inner.style.transition = v ? 'none' : '';
  }

  get state(): ViewportState {
    return { scale: this.scale, tx: this.tx, ty: this.ty };
  }

  restore(s: ViewportState | undefined): void {
    if (!s) return;
    this.scale = s.scale;
    this.tx = s.tx;
    this.ty = s.ty;
    this.apply();
  }

  private apply(): void {
    this.inner.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    this.onChange();
  }

  /** Whether the pointer is over overlaid UI rather than the board itself. */
  static onOverlaidUI(ev: Event): boolean {
    const t = ev.target as Element | null;
    return !!t?.closest?.('#qpanel, #librarypanel, #banner, #warnings, .sticky-fo, .sticky-note, #bar');
  }

  toBoard(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(clientX - r.left - this.tx) / this.scale, (clientY - r.top - this.ty) / this.scale];
  }

  fit(): void {
    const content = this.inner.firstElementChild as SVGSVGElement | null;
    if (!content) return;
    const w = Number(content.getAttribute('width')) || content.getBoundingClientRect().width;
    const h = Number(content.getAttribute('height')) || content.getBoundingClientRect().height;
    if (!w || !h) return;
    const r = this.canvas.getBoundingClientRect();
    const pad = 16;
    this.scale = Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h, 1.6);
    if (!isFinite(this.scale) || this.scale <= 0) this.scale = 1;
    this.tx = (r.width - w * this.scale) / 2;
    this.ty = (r.height - h * this.scale) / 2;
    this.apply();
  }

  reset(): void {
    this.scale = 1;
    this.tx = 8;
    this.ty = 8;
    this.apply();
  }

  zoomAt(factor: number, cx: number, cy: number): void {
    const next = Math.max(0.08, Math.min(6, this.scale * factor));
    const k = next / this.scale;
    this.tx = cx - (cx - this.tx) * k;
    this.ty = cy - (cy - this.ty) * k;
    this.scale = next;
    this.apply();
  }

  zoom(factor: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.zoomAt(factor, r.width / 2, r.height / 2);
  }

  panBy(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
    this.apply();
  }

  /** Keeps a box in view — used when keyboard focus moves to an off-screen node. */
  revealBox(x: number, y: number, w: number, h: number): void {
    const r = this.canvas.getBoundingClientRect();
    const left = x * this.scale + this.tx;
    const top = y * this.scale + this.ty;
    const right = left + w * this.scale;
    const bottom = top + h * this.scale;
    const pad = 32;
    if (left < pad) this.tx += pad - left;
    else if (right > r.width - pad) this.tx -= right - (r.width - pad);
    if (top < pad) this.ty += pad - top;
    else if (bottom > r.height - pad) this.ty -= bottom - (r.height - pad);
    this.apply();
  }

  private attach(): void {
    this.canvas.addEventListener(
      'wheel',
      (ev) => {
        if (Viewport.onOverlaidUI(ev)) return;
        ev.preventDefault();
        const r = this.canvas.getBoundingClientRect();
        this.zoomAt(ev.deltaY < 0 ? 1.12 : 1 / 1.12, ev.clientX - r.left, ev.clientY - r.top);
      },
      { passive: false }
    );

    this.canvas.addEventListener('pointerdown', (ev) => {
      if (Viewport.onOverlaidUI(ev)) return;
      // An armed tool owns the drag; panning would fight the pen.
      if ((this.canvas as HTMLElement).dataset.tool && (this.canvas as HTMLElement).dataset.tool !== 'pan') return;
      if ((ev.target as Element)?.closest?.('.board-el')) return;
      this.dragging = true;
      this.sx = ev.clientX - this.tx;
      this.sy = ev.clientY - this.ty;
      this.canvas.setPointerCapture(ev.pointerId);
      this.canvas.classList.add('grabbing');
    });

    this.canvas.addEventListener('pointermove', (ev) => {
      if (!this.dragging) return;
      this.tx = ev.clientX - this.sx;
      this.ty = ev.clientY - this.sy;
      this.apply();
    });

    const end = (ev: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      try {
        this.canvas.releasePointerCapture(ev.pointerId);
      } catch {
        /* capture may already be gone */
      }
      this.canvas.classList.remove('grabbing');
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('dblclick', (ev) => {
      if (!Viewport.onOverlaidUI(ev)) this.fit();
    });
  }
}
