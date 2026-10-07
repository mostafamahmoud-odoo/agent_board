import { describe, expect, it } from 'vitest';
import type { PlacedElement } from '../../src/webview/layout/types.js';
import { annotationBox, route } from '../../src/webview/render/paint.js';
import type { BoardSpec } from '../../src/shared/types.js';
import { layout } from '../../src/webview/layout/layout.js';
import { createFixedMeasurer } from '../../src/webview/measure/text.js';

/**
 * Edge routing quality.
 *
 * Two defects motivated these: a connector between distant boxes drove
 * straight down through every box in between (it read as a line drawn over
 * the board, not a connector), and the first fix over-corrected — a short
 * skip-one-box edge swung right across the whole board to avoid a single
 * obstacle.
 */

const box = (id: string, x: number, y: number, w = 200, h = 60): PlacedElement =>
  ({ id, type: 'node', x, y, w, h, spec: { id }, kind: 'base', shape: 'rect', lines: [id], subLines: [] }) as PlacedElement;

/** Does any segment of the route pass through this box? */
function crosses(pts: [number, number][], e: PlacedElement, pad = 2): boolean {
  for (let i = 1; i < pts.length; i++) {
    const [p, q] = [pts[i - 1], pts[i]];
    // pull the ends in so an endpoint resting on a border is not a crossing
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 12) continue;
    const t = 6 / len;
    const a: [number, number] = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const b: [number, number] = [q[0] - (q[0] - p[0]) * t, q[1] - (q[1] - p[1]) * t];
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]);
    const y1 = Math.max(a[1], b[1]);
    if (x1 < e.x - pad || x0 > e.x + e.w + pad || y1 < e.y - pad || y0 > e.y + e.h + pad) continue;
    return true;
  }
  return false;
}

const length = (pts: [number, number][]) => {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return n;
};

describe('routing avoids what is in the way', () => {
  it('two adjacent boxes get a direct route', () => {
    const a = box('a', 0, 0);
    const b = box('b', 0, 120);
    const pts = route(a, b, [a, b]);
    expect(pts.length).toBeLessThanOrEqual(4);
    expect(length(pts)).toBeLessThan(120);
  });

  it('a connector across a packed column does not pass through the column', () => {
    // The original defect: 6 stacked boxes between the endpoints.
    const a = box('a', 400, 0);
    const stack = Array.from({ length: 6 }, (_, i) => box(`m${i}`, 400, 100 + i * 90));
    const b = box('b', 380, 800);
    const all = [a, ...stack, b];
    const pts = route(a, b, all);
    const hit = stack.filter((m) => crosses(pts, m));
    expect(hit.map((m) => m.id), 'the route drives through the boxes between its endpoints').toEqual([]);
  });

  it('skipping ONE box takes a tight detour, not a trip across the board', () => {
    const a = box('a', 0, 0);
    const mid = box('m', 0, 100);
    const b = box('b', 0, 200);
    const pts = route(a, b, [a, mid, b]);
    expect(crosses(pts, mid), 'the route cut through the box it should skip').toBe(false);
    // Straight-line distance is 200; a sane detour stays close to it.
    expect(length(pts), `detour was ${Math.round(length(pts))}px for a 200px gap`).toBeLessThan(520);
    // And it must not wander far sideways.
    const xs = pts.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(300);
  });

  it('a route always starts and ends on the two boxes it connects', () => {
    const a = box('a', 0, 0);
    const b = box('b', 500, 400);
    const pts = route(a, b, [a, b]);
    const on = (p: [number, number], e: PlacedElement) =>
      p[0] >= e.x - 1 && p[0] <= e.x + e.w + 1 && p[1] >= e.y - 1 && p[1] <= e.y + e.h + 1;
    expect(on(pts[0], a)).toBe(true);
    expect(on(pts[pts.length - 1], b)).toBe(true);
  });

  it('is deterministic', () => {
    const a = box('a', 0, 0);
    const m = box('m', 0, 100);
    const b = box('b', 0, 200);
    expect(route(a, b, [a, m, b])).toEqual(route(a, b, [a, m, b]));
  });

  it('handles boxes that overlap without producing NaN', () => {
    const a = box('a', 0, 0);
    const b = box('b', 10, 10);
    const pts = route(a, b, [a, b]);
    for (const [x, y] of pts) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });
});

describe('edges route around margin text (regression)', () => {
  /*
   * The router was only ever given `layout.elements`, so annotations were
   * invisible to it and cross-frame connectors ran straight through blocks of
   * margin text. On a real 19-node board, 9 of 16 edges struck an annotation.
   * Text is the part a reader is trying to read; an edge through it is worse
   * than a longer route.
   */
  const spec: BoardSpec = {
    title: 'routing vs notes',
    layout: 'columns',
    frames: [
      { id: 'L', title: 'LEFT', row: 1, col: 1, nodes: ['a1', 'a2'] },
      { id: 'R', title: 'RIGHT', row: 1, col: 2, nodes: ['b1', 'b2'] }
    ],
    nodes: [
      { id: 'a1', label: 'alpha' },
      { id: 'a2', label: 'beta' },
      { id: 'b1', label: 'gamma' },
      { id: 'b2', label: 'delta' }
    ],
    edges: [
      { from: 'a1', to: 'b2' },
      { from: 'a2', to: 'b1' }
    ],
    annotations: [
      { text: 'a long margin note that sits\nright between the two frames', at: 'a1', place: 'right' }
    ]
  };

  /** How many edges strike annotation text, routing with or without them. */
  const struck = (avoidAnnotations: boolean) => {
    const L = layout(spec, createFixedMeasurer());
    const boxes = L.annotations.map(annotationBox);
    const obstacles = avoidAnnotations ? [...L.elements, ...boxes] : L.elements;
    let n = 0;
    for (const e of L.edges) {
      const a = L.byId[e.from];
      const b = L.byId[e.to];
      if (!a || !b) continue;
      const pts = route(a, b, obstacles) as [number, number][];
      if (boxes.some((bx) => crosses(pts, bx as unknown as PlacedElement, 0))) n++;
    }
    return n;
  };

  it('strikes less text than routing blind to the annotations', () => {
    // Not "zero": this fixture deliberately parks the note in the only gap
    // between the two frames, so one edge has nowhere clean to go and the
    // router picks the least-bad option. The claim is that knowing about the
    // text strictly improves on not knowing — on the real 19-node board that
    // motivated this, it took 9 struck edges down to 2.
    expect(struck(true)).toBeLessThan(struck(false));
  });

  it('annotationBox covers the text with clearance, not just its glyph box', () => {
    const L = layout(spec, createFixedMeasurer());
    const a = L.annotations[0];
    const b = annotationBox(a);
    expect(b.w).toBeGreaterThan(a.textW);
    expect(b.y).toBeLessThan(a.y - a.size);
  });

  it('a blocked edge takes a proportionate detour, not a lap of the board', () => {
    // The lane is derived from the obstruction, not the endpoints — folding
    // the endpoints in sent an edge starting in a far-left frame out past the
    // edge of the whole board and back.
    const L = layout(spec, createFixedMeasurer());
    const boxes = L.annotations.map(annotationBox);
    const a = L.byId.a1;
    const b = L.byId.b2;
    const pts = route(a, b, [...L.elements, ...boxes]) as [number, number][];
    const direct = Math.hypot(b.x - a.x, b.y - a.y);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    expect(len).toBeLessThan(direct * 3);
  });
});
