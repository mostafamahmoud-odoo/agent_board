import type { LayoutResult, PlacedElement } from '../layout/types.js';
import { ariaLabel } from './describe.js';

/**
 * Roving tabindex over board elements (FR-026).
 *
 * One element is tabbable at a time; arrows move between them. Putting 200
 * nodes in the tab order would make Tab useless for everyone.
 */
export class BoardFocus {
  private nodes: { g: SVGGElement; e: PlacedElement }[] = [];
  private index = 0;

  reset(): void {
    this.nodes = [];
    this.index = 0;
  }

  register(g: SVGGElement, e: PlacedElement, layout: LayoutResult): void {
    g.setAttribute('role', 'graphics-object');
    g.setAttribute('aria-label', ariaLabel(e, layout));
    g.setAttribute('tabindex', this.nodes.length === 0 ? '0' : '-1');
    g.classList.add('board-el');
    this.nodes.push({ g, e });
  }

  get current(): PlacedElement | undefined {
    return this.nodes[this.index]?.e;
  }

  get count(): number {
    return this.nodes.length;
  }

  move(delta: number): PlacedElement | undefined {
    if (!this.nodes.length) return undefined;
    this.nodes[this.index]?.g.setAttribute('tabindex', '-1');
    this.index = (this.index + delta + this.nodes.length) % this.nodes.length;
    const next = this.nodes[this.index];
    next.g.setAttribute('tabindex', '0');
    next.g.focus?.();
    return next.e;
  }

  focusFirst(): PlacedElement | undefined {
    if (!this.nodes.length) return undefined;
    this.index = 0;
    const n = this.nodes[0];
    n.g.setAttribute('tabindex', '0');
    n.g.focus?.();
    return n.e;
  }
}
