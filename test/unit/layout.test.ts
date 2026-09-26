import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BoardSpec } from '../../src/shared/types.js';
import { createFixedMeasurer } from '../../src/webview/measure/text.js';
import { layout } from '../../src/webview/layout/layout.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BOARDS = path.join(here, '../fixtures/boards');

const m = createFixedMeasurer();
const load = (f: string): BoardSpec => JSON.parse(fs.readFileSync(path.join(BOARDS, f), 'utf8'));
const fixtures = fs.readdirSync(BOARDS).filter((f) => f.endsWith('.json'));

/** Round so a metric tweak does not churn every snapshot. */
const round = (n: number) => Math.round(n * 100) / 100;

describe('golden corpus (SC-005: zero migration for existing boards)', () => {
  it('has fixtures to check', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const f of fixtures) {
    it(`lays out ${f} and matches its snapshot`, () => {
      const L = layout(load(f), m);
      expect({
        bounds: {
          minX: round(L.bounds.minX),
          minY: round(L.bounds.minY),
          maxX: round(L.bounds.maxX),
          maxY: round(L.bounds.maxY)
        },
        frames: L.frames.map((fr) => ({ id: fr.id, box: [round(fr.x), round(fr.y), round(fr.w), round(fr.h)], ids: fr.ids })),
        elements: L.elements.map((e) => ({ id: e.id, type: e.type, box: [round(e.x), round(e.y), round(e.w), round(e.h)] })),
        edges: L.edges.map((e) => ({ from: e.from, to: e.to })),
        annotations: L.annotations.map((a) => ({ x: round(a.x), y: round(a.y), anchor: a.anchor, lines: a.lines.length })),
        legend: L.legend ? { x: round(L.legend.x), y: round(L.legend.y), w: round(L.legend.w) } : null,
        warnings: L.warnings.map((w) => w.code)
      }).toMatchSnapshot();
    });
  }
});

describe('layout is pure (data-model L1, L2)', () => {
  it('does not mutate the spec it is given', () => {
    const spec = load('all-kinds.json');
    const before = JSON.stringify(spec);
    layout(spec, m);
    expect(JSON.stringify(spec)).toBe(before);
  });

  it('is deterministic across runs', () => {
    const spec = load('tables-and-screens.json');
    expect(JSON.stringify(layout(spec, m))).toBe(JSON.stringify(layout(spec, m)));
  });

  it('never writes underscore-prefixed geometry back onto spec objects', () => {
    const spec = load('tables-and-screens.json');
    layout(spec, m);
    const leaked: string[] = [];
    const walk = (o: unknown, at: string) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (k.startsWith('_')) leaked.push(`${at}.${k}`);
        walk(v, `${at}.${k}`);
      }
    };
    walk(spec, 'spec');
    expect(leaked).toEqual([]);
  });
});

describe('everything inside the bounds (FR-041)', () => {
  // The old renderer computed annotation placement twice - in drawAnnotation
  // and again in drawSketchy's bounds pass - and the copies had diverged: the
  // bounds copy omitted the owner-frame clamp, so a clamped annotation could
  // be painted outside the viewBox. Placement now happens once, so this holds
  // by construction; the test is what keeps it that way.
  for (const f of fixtures) {
    it(`${f}: no element, frame or annotation falls outside bounds`, () => {
      const L = layout(load(f), m);
      const { minX, minY, maxX, maxY } = L.bounds;
      const outside: string[] = [];

      for (const fr of L.frames) {
        if (fr.x < minX || fr.y < minY || fr.x + fr.w > maxX || fr.y + fr.h > maxY) outside.push(`frame ${fr.id}`);
      }
      for (const e of L.elements) {
        if (e.x < minX || e.y < minY || e.x + e.w > maxX || e.y + e.h > maxY) outside.push(`element ${e.id}`);
      }
      for (const a of L.annotations) {
        const left = a.anchor === 'end' ? a.x - a.textW : a.anchor === 'middle' ? a.x - a.textW / 2 : a.x;
        const bottom = a.y + (a.lines.length - 1) * (a.size + 4);
        if (left < minX || left + a.textW > maxX || a.y - a.size < minY || bottom > maxY) {
          outside.push(`annotation "${a.spec.text.slice(0, 24)}"`);
        }
      }
      if (L.legend && (L.legend.x + L.legend.w > maxX || L.legend.y + L.legend.h > maxY)) {
        outside.push('legend');
      }
      expect(outside).toEqual([]);
    });
  }
});

describe('degrades rather than failing (FR-011)', () => {
  it('drops a dangling edge, warns, and still lays out the valid nodes', () => {
    const L = layout(
      { title: 't', nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'ghost' }] },
      m
    );
    expect(L.elements).toHaveLength(1);
    expect(L.edges).toHaveLength(0);
    expect(L.warnings.map((w) => w.code)).toContain('dangling-edge');
  });

  it('falls back on an unknown kind and says so, instead of failing the board', () => {
    const L = layout({ title: 't', nodes: [{ id: 'a', kind: 'banana' as never }] }, m);
    expect(L.elements).toHaveLength(1);
    expect((L.elements[0] as { kind: string }).kind).toBe('base');
    expect(L.warnings.map((w) => w.code)).toContain('unknown-kind');
  });

  it('falls back on an unknown shape and says so', () => {
    const L = layout({ title: 't', nodes: [{ id: 'a', shape: 'blob' as never }] }, m);
    expect((L.elements[0] as { shape: string }).shape).toBe('rect');
    expect(L.warnings.map((w) => w.code)).toContain('unknown-shape');
  });

  it('warns when an element names a frame that does not exist', () => {
    const L = layout({ title: 't', nodes: [{ id: 'a', frame: 'nope' }] }, m);
    expect(L.elements).toHaveLength(1);
    expect(L.warnings.map((w) => w.code)).toContain('missing-frame');
  });

  it('reports an empty board rather than producing a degenerate viewBox', () => {
    const L = layout({ title: 'empty' }, m);
    expect(L.empty).toBe(true);
    expect(L.bounds.maxX).toBeGreaterThan(L.bounds.minX);
  });

  it('skips a duplicate element id and warns', () => {
    const L = layout({ title: 't', nodes: [{ id: 'a' }, { id: 'a' }] }, m);
    expect(L.elements).toHaveLength(1);
    expect(L.warnings.map((w) => w.code)).toContain('duplicate-id');
  });
});

describe('edge seeds are identity-based, not index-based', () => {
  it('inserting an edge does not change the seed of the ones after it', () => {
    const before = layout({ title: 't', nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] }, m);
    const after = layout({ title: 't', nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [{ from: 'a', to: 'c' }, { from: 'a', to: 'b' }, { from: 'b', to: 'c' }] }, m);
    const seed = (L: typeof before, from: string, to: string) =>
      L.edges.find((e) => e.from === from && e.to === to)?.seed;
    expect(seed(after, 'a', 'b')).toBe(seed(before, 'a', 'b'));
    expect(seed(after, 'b', 'c')).toBe(seed(before, 'b', 'c'));
  });
});

describe('aliases the renderer already accepted (FR-012)', () => {
  it('reads `groups` as an alias for `frames`', () => {
    const L = layout({ title: 't', groups: [{ id: 'g', title: 'G', nodes: ['a'] }], nodes: [{ id: 'a' }] }, m);
    expect(L.frames.map((f) => f.id)).toEqual(['g']);
    expect(L.frames[0].ids).toEqual(['a']);
  });

  it('reads `notes` as an alias for `annotations`', () => {
    // Needs an anchor: an annotation with no `at`/`atFrame` and no x/y has no
    // position at all and is correctly dropped, as the original renderer did.
    const L = layout({ title: 't', nodes: [{ id: 'a' }], notes: [{ text: 'hello', at: 'a' }] }, m);
    expect(L.annotations).toHaveLength(1);
  });

  it('drops an annotation that has no anchor and no coordinates', () => {
    const L = layout({ title: 't', nodes: [{ id: 'a' }], annotations: [{ text: 'nowhere' }] }, m);
    expect(L.annotations).toEqual([]);
  });

  it('reads `source`/`target` as aliases for `from`/`to`', () => {
    const L = layout({ title: 't', nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 'a', target: 'b' }] }, m);
    expect(L.edges).toHaveLength(1);
  });

  it('ignores an unknown top-level field', () => {
    const L = layout({ title: 't', nodes: [{ id: 'a' }], wibble: 42 } as BoardSpec, m);
    expect(L.elements).toHaveLength(1);
    expect(L.warnings).toEqual([]);
  });
});

describe('legacy hand-placed geometry still works', () => {
  it('honours x/y and treats w as authoritative but h as a minimum', () => {
    const L = layout({ title: 't', nodes: [{ id: 'a', label: 'x', x: 10, y: 20, w: 200, h: 1 }] }, m);
    const e = L.elements[0];
    expect([e.x, e.y, e.w]).toEqual([10, 20, 200]);
    expect(e.h).toBeGreaterThan(1);
  });
});

describe('a screen grows to fit its content, as SKILL.md promises (T145)', () => {
  it('grows for an embedded table wider than `width`', () => {
    const L = layout(
      {
        title: 't',
        screens: [
          {
            id: 's',
            width: 200,
            table: {
              id: 'tb',
              columns: [{ label: 'a very wide column header indeed' }, { label: 'and another one' }],
              rows: [['some quite long cell content here', 'and more of it over here too']]
            }
          }
        ]
      },
      m
    );
    expect(L.elements[0].w).toBeGreaterThan(200);
  });

  it('ALSO grows for wide field groups — it used not to', () => {
    const narrow = layout(
      { title: 't', screens: [{ id: 's', width: 200, groups: [{ fields: [{ label: 'x', value: 'y' }] }] }] },
      m
    );
    const wide = layout(
      {
        title: 't',
        screens: [
          {
            id: 's',
            width: 200,
            groups: [
              {
                fields: [
                  { label: 'A really quite long field label here', value: 'and a correspondingly long value' }
                ]
              }
            ]
          }
        ]
      },
      m
    );
    expect(wide.elements[0].w).toBeGreaterThan(narrow.elements[0].w);
    expect(wide.elements[0].w).toBeGreaterThan(200);
  });

  it('treats `width` as a minimum, never a maximum', () => {
    const L = layout({ title: 't', screens: [{ id: 's', width: 900, groups: [{ fields: [{ label: 'x' }] }] }] }, m);
    expect(L.elements[0].w).toBeGreaterThanOrEqual(900);
  });
});
