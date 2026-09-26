import rough from 'roughjs';
import type { RoughSVG } from 'roughjs/bin/svg';
import { el, line as svgLine, path as svgPath, rect as svgRect } from './svg.js';

/**
 * The stroke strategy.
 *
 * FR-017 says a board's geometry must be identical across styles. The way to
 * guarantee that is not discipline — it is to have ONE drawing pass and swap
 * only how a stroke is produced. `sketchy` and `clean` differ by this
 * interface and nothing else.
 */
export interface Pen {
  readonly id: 'sketchy' | 'clean';
  rect(g: SVGGElement, x: number, y: number, w: number, h: number, s: Stroke): void;
  roundRect(g: SVGGElement, x: number, y: number, w: number, h: number, r: number, s: Stroke): void;
  ellipse(g: SVGGElement, cx: number, cy: number, w: number, h: number, s: Stroke): void;
  polygon(g: SVGGElement, pts: [number, number][], s: Stroke): void;
  path(g: SVGGElement, d: string, s: Stroke): void;
  line(g: SVGGElement, x1: number, y1: number, x2: number, y2: number, s: Stroke): void;
  polyline(g: SVGGElement, pts: [number, number][], s: Stroke): void;
}

export interface Stroke {
  /** Per-element override; frames are softer than boxes. */
  roughness?: number;
  stroke: string;
  fill?: string;
  width?: number;
  dash?: number[] | null;
  /** Stable per-element seed, so a redraw reproduces the same wobble. */
  seed?: number;
  /** Hand-shaded fill, conventionally "not built yet". */
  hatch?: boolean;
  opacity?: number;
}

/* ------------------------------------------------------------------ */
/* clean: precise SVG                                                  */
/* ------------------------------------------------------------------ */

export class CleanPen implements Pen {
  readonly id = 'clean' as const;

  rect(g: SVGGElement, x: number, y: number, w: number, h: number, s: Stroke): void {
    svgRect(g, x, y, w, h, { ...this.base(s), rx: 2 });
  }

  roundRect(g: SVGGElement, x: number, y: number, w: number, h: number, r: number, s: Stroke): void {
    svgRect(g, x, y, w, h, { ...this.base(s), rx: r });
  }

  ellipse(g: SVGGElement, cx: number, cy: number, w: number, h: number, s: Stroke): void {
    const e = el('ellipse');
    e.setAttribute('cx', String(cx));
    e.setAttribute('cy', String(cy));
    e.setAttribute('rx', String(w / 2));
    e.setAttribute('ry', String(h / 2));
    const b = this.base(s);
    e.setAttribute('fill', b.fill || 'none');
    e.setAttribute('stroke', b.stroke || 'none');
    if (b.strokeWidth) e.setAttribute('stroke-width', String(b.strokeWidth));
    if (b.dash) e.setAttribute('stroke-dasharray', b.dash.join(' '));
    g.appendChild(e);
  }

  polygon(g: SVGGElement, pts: [number, number][], s: Stroke): void {
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ') + ' Z';
    svgPath(g, d, this.base(s));
  }

  path(g: SVGGElement, d: string, s: Stroke): void {
    svgPath(g, d, this.base(s));
  }

  line(g: SVGGElement, x1: number, y1: number, x2: number, y2: number, s: Stroke): void {
    svgLine(g, x1, y1, x2, y2, { stroke: s.stroke, strokeWidth: s.width ?? 1.4, dash: s.dash, opacity: s.opacity });
  }

  polyline(g: SVGGElement, pts: [number, number][], s: Stroke): void {
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
    svgPath(g, d, { ...this.base(s), fill: 'none' });
  }

  private base(s: Stroke) {
    return {
      fill: s.fill && s.fill !== 'transparent' ? s.fill : undefined,
      stroke: s.stroke,
      strokeWidth: s.width ?? 1.4,
      dash: s.dash,
      opacity: s.opacity
    };
  }
}

/* ------------------------------------------------------------------ */
/* sketchy: rough.js                                                   */
/* ------------------------------------------------------------------ */

export class SketchyPen implements Pen {
  readonly id = 'sketchy' as const;
  private rc: RoughSVG;

  constructor(svg: SVGSVGElement) {
    this.rc = rough.svg(svg);
  }

  private opts(s: Stroke): Record<string, unknown> {
    const o: Record<string, unknown> = {
      stroke: s.stroke,
      strokeWidth: s.width ?? 1.4,
      // Tuned down from 1.4/1.2. Higher values read as scratchy rather than
      // hand-drawn: strokes miss their corners and a board of them looks
      // untidy instead of deliberate. `preserveVertices` keeps corners where
      // the layout put them, which matters for boxes and elbows.
      roughness: s.roughness ?? 0.85,
      bowing: 0.7,
      preserveVertices: true,
      seed: s.seed ?? 1
    };
    if (s.fill && s.fill !== 'transparent') {
      o.fill = s.fill;
      o.fillStyle = s.hatch ? 'hachure' : 'solid';
      if (s.hatch) {
        o.hachureAngle = -41;
        o.hachureGap = 6;
        o.fillWeight = 1;
      }
    }
    if (s.dash) {
      o.strokeLineDash = s.dash;
    }
    return o;
  }

  private add(g: SVGGElement, node: SVGGElement, s: Stroke): void {
    if (s.opacity != null) node.setAttribute('opacity', String(s.opacity));
    g.appendChild(node);
  }

  rect(g: SVGGElement, x: number, y: number, w: number, h: number, s: Stroke): void {
    this.add(g, this.rc.rectangle(x, y, w, h, this.opts(s)), s);
  }

  roundRect(g: SVGGElement, x: number, y: number, w: number, h: number, r: number, s: Stroke): void {
    const d =
      `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} ` +
      `L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} ` +
      `L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} ` +
      `L${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`;
    this.add(g, this.rc.path(d, this.opts(s)), s);
  }

  ellipse(g: SVGGElement, cx: number, cy: number, w: number, h: number, s: Stroke): void {
    this.add(g, this.rc.ellipse(cx, cy, w, h, this.opts(s)), s);
  }

  polygon(g: SVGGElement, pts: [number, number][], s: Stroke): void {
    this.add(g, this.rc.polygon(pts, this.opts(s)), s);
  }

  path(g: SVGGElement, d: string, s: Stroke): void {
    this.add(g, this.rc.path(d, this.opts(s)), s);
  }

  line(g: SVGGElement, x1: number, y1: number, x2: number, y2: number, s: Stroke): void {
    this.add(g, this.rc.line(x1, y1, x2, y2, this.opts(s)), s);
  }

  polyline(g: SVGGElement, pts: [number, number][], s: Stroke): void {
    this.add(g, this.rc.linearPath(pts, this.opts(s)), s);
  }
}
