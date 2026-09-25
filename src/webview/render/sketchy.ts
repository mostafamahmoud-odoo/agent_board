import type { LayoutResult } from '../layout/types.js';
import type { Palette } from '../theme/palette.js';
import { paint } from './paint.js';
import { SketchyPen } from './pen.js';
import { el } from './svg.js';
import type { Renderer, RenderOptions } from './renderer.js';

/** The hand-drawn whiteboard. Geometry comes from layout; this is stroke only. */
export const sketchyRenderer: Renderer = {
  id: 'sketchy',
  render(layout: LayoutResult, palette: Palette, opts: RenderOptions = {}): SVGSVGElement {
    // rough.js needs an svg to attach its defs to before drawing.
    const host = el('svg');
    return paint(layout, palette, new SketchyPen(host), host, opts);
  }
};
