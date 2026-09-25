/** Shared SVG primitives for every renderer. No rough.js, no theme decisions. */

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function el<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

export interface TextOptions {
  size: number;
  fill: string;
  anchor?: 'start' | 'middle' | 'end';
  bold?: boolean;
  opacity?: number;
  rotate?: number;
  family?: string;
  className?: string;
}

export function text(parent: SVGElement, str: string, x: number, y: number, o: TextOptions): SVGTextElement {
  const t = el('text');
  t.setAttribute('x', String(x));
  t.setAttribute('y', String(y));
  t.setAttribute('font-size', String(o.size));
  t.setAttribute('fill', o.fill);
  t.setAttribute('text-anchor', o.anchor || 'middle');
  if (o.className) t.setAttribute('class', o.className);
  if (o.family) t.setAttribute('font-family', o.family);
  if (o.bold) t.setAttribute('font-weight', '600');
  if (o.opacity != null) t.setAttribute('opacity', String(o.opacity));
  if (o.rotate) t.setAttribute('transform', `rotate(${o.rotate} ${x} ${y})`);
  // textContent, never innerHTML: board text is agent-written data.
  t.textContent = str;
  parent.appendChild(t);
  return t;
}

export function lines(
  parent: SVGElement,
  ls: string[],
  cx: number,
  firstBaseline: number,
  lh: number,
  o: TextOptions
): void {
  ls.forEach((l, i) => text(parent, l, cx, firstBaseline + i * lh, o));
}

export function rect(
  parent: SVGElement,
  x: number,
  y: number,
  w: number,
  h: number,
  o: { fill?: string; stroke?: string; strokeWidth?: number; rx?: number; opacity?: number; dash?: number[] | null }
): SVGRectElement {
  const r = el('rect');
  r.setAttribute('x', String(x));
  r.setAttribute('y', String(y));
  r.setAttribute('width', String(Math.max(0, w)));
  r.setAttribute('height', String(Math.max(0, h)));
  if (o.rx) r.setAttribute('rx', String(o.rx));
  r.setAttribute('fill', o.fill || 'none');
  if (o.stroke) r.setAttribute('stroke', o.stroke);
  if (o.strokeWidth) r.setAttribute('stroke-width', String(o.strokeWidth));
  if (o.dash) r.setAttribute('stroke-dasharray', o.dash.join(' '));
  if (o.opacity != null) r.setAttribute('opacity', String(o.opacity));
  parent.appendChild(r);
  return r;
}

export function line(
  parent: SVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  o: { stroke: string; strokeWidth?: number; dash?: number[] | null; opacity?: number }
): SVGLineElement {
  const l = el('line');
  l.setAttribute('x1', String(x1));
  l.setAttribute('y1', String(y1));
  l.setAttribute('x2', String(x2));
  l.setAttribute('y2', String(y2));
  l.setAttribute('stroke', o.stroke);
  if (o.strokeWidth) l.setAttribute('stroke-width', String(o.strokeWidth));
  if (o.dash) l.setAttribute('stroke-dasharray', o.dash.join(' '));
  if (o.opacity != null) l.setAttribute('opacity', String(o.opacity));
  parent.appendChild(l);
  return l;
}

export function path(
  parent: SVGElement,
  d: string,
  o: { fill?: string; stroke?: string; strokeWidth?: number; dash?: number[] | null; opacity?: number }
): SVGPathElement {
  const p = el('path');
  p.setAttribute('d', d);
  p.setAttribute('fill', o.fill || 'none');
  if (o.stroke) p.setAttribute('stroke', o.stroke);
  if (o.strokeWidth) p.setAttribute('stroke-width', String(o.strokeWidth));
  if (o.dash) p.setAttribute('stroke-dasharray', o.dash.join(' '));
  if (o.opacity != null) p.setAttribute('opacity', String(o.opacity));
  parent.appendChild(p);
  return p;
}

export function polyline(parent: SVGElement, pts: [number, number][], o: Parameters<typeof path>[2]): SVGPathElement {
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
  return path(parent, d, o);
}
