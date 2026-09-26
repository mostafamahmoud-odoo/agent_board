import { describe, expect, it } from 'vitest';
import type { PlacedElement } from '../../src/webview/layout/types.js';
import { route } from '../../src/webview/render/paint.js';

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
