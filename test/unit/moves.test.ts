import { describe, expect, it } from 'vitest';
import type { BoardSpec, MoveMap } from '../../src/shared/types.js';
import { createFixedMeasurer } from '../../src/webview/measure/text.js';
import { layout } from '../../src/webview/layout/layout.js';

/**
 * Dragging a node records an OFFSET against its id, which layout applies on
 * the next render. Doing it in layout rather than as a draw-time transform is
 * what makes edges, annotations and bounds follow the node — a render-time
 * transform would leave connectors pointing at where it used to be.
 */

const m = createFixedMeasurer();

const board: BoardSpec = {
  title: 'movable',
  frames: [{ id: 'f', title: 'group', nodes: ['a', 'b'] }],
  nodes: [
    { id: 'a', label: 'alpha' },
    { id: 'b', label: 'beta' }
  ],
  edges: [{ from: 'a', to: 'b' }],
  annotations: [{ text: 'about alpha', at: 'a', place: 'left' }]
};

describe('user moves', () => {
  it('no offsets means the layout is untouched', () => {
    const a = layout(board, m);
    const b = layout(board, m, {});
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('an offset moves exactly the element it names', () => {
    const before = layout(board, m);
    const after = layout(board, m, { a: { dx: 100, dy: 40 } });
    const at = (L: typeof before, id: string) => L.byId[id];
    expect(at(after, 'a').x - at(before, 'a').x).toBe(100);
    expect(at(after, 'a').y - at(before, 'a').y).toBe(40);
    expect(at(after, 'b').x).toBe(at(before, 'b').x);
    expect(at(after, 'b').y).toBe(at(before, 'b').y);
  });

  it('the annotation anchored to a moved node follows it', () => {
    const before = layout(board, m);
    const after = layout(board, m, { a: { dx: 100, dy: 40 } });
    expect(after.annotations[0].x).not.toBe(before.annotations[0].x);
    expect(after.annotations[0].y - before.annotations[0].y).toBe(40);
  });

  it('bounds grow to include a node dragged outside them', () => {
    const before = layout(board, m);
    const after = layout(board, m, { a: { dx: 900, dy: 0 } });
    expect(after.bounds.maxX).toBeGreaterThan(before.bounds.maxX);
  });

  it('an offset for an id that is not on the board is ignored', () => {
    const a = layout(board, m);
    const b = layout(board, m, { ghost: { dx: 50, dy: 50 } } as MoveMap);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('a zero offset is the same as none', () => {
    const a = layout(board, m);
    const b = layout(board, m, { a: { dx: 0, dy: 0 } });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('offsets are additive across a re-render, not cumulative per frame', () => {
    // The offset is absolute against the laid-out position, so rendering
    // twice with the same map must not drift.
    const once = layout(board, m, { a: { dx: 30, dy: 30 } });
    const twice = layout(board, m, { a: { dx: 30, dy: 30 } });
    expect(twice.byId.a.x).toBe(once.byId.a.x);
  });
});
