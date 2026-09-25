import type { Palette } from '../theme/palette.js';
import type { LayoutResult, PlacedElement } from '../layout/types.js';

/**
 * One interface over LayoutResult. Every style is a different *stroke
 * treatment* of the same geometry — which is what makes the clean renderer a
 * couple of hundred lines instead of a second engine, and what guarantees a
 * board looks the same shape in all three.
 */
export interface Renderer {
  readonly id: 'sketchy' | 'clean';
  render(layout: LayoutResult, palette: Palette, opts: RenderOptions): SVGSVGElement;
}

export interface RenderOptions {
  /** Board margin. */
  margin?: number;
  /**
   * Per-element hook so a11y focus can attach roving tabindex and labels to
   * the very nodes that were drawn.
   */
  onElement?: (g: SVGGElement, e: PlacedElement) => void;
}

export const MARGIN = 24;

/** Wraps a rendered group in a sized, viewBox'd svg. */
export function frameSvg(g: SVGGElement, layout: LayoutResult, margin = MARGIN): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const { minX, minY, maxX, maxY } = layout.bounds;
  const w = maxX - minX + 2 * margin;
  const h = maxY - minY + 2 * margin;
  g.setAttribute('transform', `translate(${margin - minX},${margin - minY})`);
  svg.appendChild(g);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  return svg;
}
