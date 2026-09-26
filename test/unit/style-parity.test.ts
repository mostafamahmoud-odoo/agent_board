import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BoardSpec } from '../../src/shared/types.js';
import { createFixedMeasurer } from '../../src/webview/measure/text.js';
import { layout } from '../../src/webview/layout/layout.js';

/**
 * FR-017: a board's geometry must be identical across render styles.
 *
 * The structural guarantee is that sketchy and clean share ONE drawing pass
 * (paint.ts) and differ only by a Pen — so parity holds by construction. This
 * test is what keeps that true: it fails the moment a renderer starts
 * deriving its own positions, which is exactly how the old annotation bounds
 * code drifted.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const BOARDS = path.join(here, '../fixtures/boards');
const m = createFixedMeasurer();
const fixtures = fs.readdirSync(BOARDS).filter((f) => f.endsWith('.json'));

const load = (f: string): BoardSpec => JSON.parse(fs.readFileSync(path.join(BOARDS, f), 'utf8'));

describe('layout is independent of render style', () => {
  for (const f of fixtures) {
    it(`${f}: identical geometry whichever style will draw it`, () => {
      // layout() takes no style and no palette at all — the strongest possible
      // form of this guarantee. Asserting it explicitly stops anyone
      // "helpfully" threading style through later.
      const a = layout({ ...load(f), style: 'sketchy' }, m);
      const b = layout({ ...load(f), style: 'clean' }, m);

      const geometry = (L: typeof a) => ({
        bounds: L.bounds,
        frames: L.frames.map((x) => [x.id, x.x, x.y, x.w, x.h]),
        elements: L.elements.map((x) => [x.id, x.x, x.y, x.w, x.h]),
        edges: L.edges.map((x) => [x.from, x.to]),
        annotations: L.annotations.map((x) => [x.x, x.y, x.anchor, x.lines.length]),
        legend: L.legend ? [L.legend.x, L.legend.y, L.legend.w] : null
      });

      expect(geometry(b)).toEqual(geometry(a));
    });
  }

  it('layout() does not accept a palette or a style parameter', () => {
    // Colour never affects geometry: that is what lets a theme change redraw
    // without re-laying-out, and therefore without losing pan/zoom (FR-023).
    expect(layout.length).toBe(2); // (spec, measurer)
  });
});

describe('both renderers consume the same LayoutResult', () => {
  it('every element placed by layout is addressable by id', () => {
    const L = layout(load('all-kinds.json'), m);
    for (const e of L.elements) expect(L.byId[e.id]).toBe(e);
  });

  it('edges only ever reference elements that exist', () => {
    for (const f of fixtures) {
      const L = layout(load(f), m);
      for (const e of L.edges) {
        expect(L.byId[e.from], `${f}: edge from ${e.from}`).toBeDefined();
        expect(L.byId[e.to], `${f}: edge to ${e.to}`).toBeDefined();
      }
    }
  });
});
