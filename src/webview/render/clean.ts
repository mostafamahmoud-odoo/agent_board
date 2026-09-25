import type { LayoutResult } from '../layout/types.js';
import type { Palette } from '../theme/palette.js';
import { paint } from './paint.js';
import { CleanPen } from './pen.js';
import { el } from './svg.js';
import type { Renderer, RenderOptions } from './renderer.js';

/**
 * The precise style, for boards you show other people.
 *
 * It is this short because it shares `paint()` with sketchy and differs only
 * in the Pen. That is FR-017 ("identical geometry across styles") enforced by
 * construction rather than by discipline.
 */
export const cleanRenderer: Renderer = {
  id: 'clean',
  render(layout: LayoutResult, palette: Palette, opts: RenderOptions = {}): SVGSVGElement {
    const host = el('svg');
    return paint(layout, palette, new CleanPen(), host, opts);
  }
};
