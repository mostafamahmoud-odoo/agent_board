import { describe, expect, it } from 'vitest';
import { decimate } from '../../src/webview/interact/marks.js';

describe('pen stroke decimation (FR-040)', () => {
  it('keeps a two-point stroke intact', () => {
    const pts: [number, number][] = [[0, 0], [10, 10]];
    expect(decimate(pts)).toEqual(pts);
  });

  it('collapses a straight line sampled many times', () => {
    const pts: [number, number][] = Array.from({ length: 500 }, (_, i) => [i, 0]);
    const out = decimate(pts);
    expect(out.length).toBeLessThan(5);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([499, 0]);
  });

  it('preserves a corner', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 50; i++) pts.push([i, 0]);
    for (let i = 1; i <= 50; i++) pts.push([50, i]);
    const out = decimate(pts);
    expect(out.length).toBeLessThan(pts.length / 5);
    // the corner itself must survive
    expect(out.some(([x, y]) => x === 50 && y === 0)).toBe(true);
  });

  it('stays under the schema cap for a long freehand stroke', () => {
    // A pathological "scribble": 6000 samples, the case that used to be
    // written verbatim into a file that only ever grew.
    const pts: [number, number][] = Array.from({ length: 6000 }, (_, i) => [
      i * 0.3,
      Math.sin(i / 20) * 40
    ]);
    const out = decimate(pts);
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out.length).toBeLessThan(pts.length / 4);
  });

  it('is stable: decimating twice changes nothing further', () => {
    const pts: [number, number][] = Array.from({ length: 300 }, (_, i) => [i, Math.sin(i / 9) * 12]);
    const once = decimate(pts);
    expect(decimate(once)).toEqual(once);
  });
});
