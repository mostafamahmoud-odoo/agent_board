import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import type { BoardSpec } from '../../src/shared/types.js';
import { createFixedMeasurer } from '../../src/webview/measure/text.js';
import { layout } from '../../src/webview/layout/layout.js';
import { buildPalette } from '../../src/webview/theme/palette.js';
import { layoutToDrawio } from '../../src/webview/render/to-drawio.js';
import { resolveEmbedUrl } from '../../src/webview/render/drawio.js';

const m = createFixedMeasurer();
const p = buildPalette('dark', (_n, f) => f);

const board: BoardSpec = {
  title: 'to drawio',
  frames: [{ id: 'f1', title: 'Group one', nodes: ['a', 'b'] }],
  nodes: [
    { id: 'a', label: 'alpha', sub: 'evidence', kind: 'problem' },
    { id: 'b', label: 'beta', shape: 'diamond', emphasis: true }
  ],
  edges: [{ from: 'a', to: 'b', label: 'link', style: 'dashed' }],
  annotations: [{ text: 'a margin note', at: 'a', place: 'left' }],
  tables: [{ id: 't1', title: 'rows', columns: [{ label: 'id' }, { label: 'qty', align: 'right' }], rows: [['1', '90']] }]
};

const xml = () => layoutToDrawio(layout(board, m), board.title, p);

describe('board -> draw.io xml', () => {
  it('is a well-formed mxfile', () => {
    const x = xml();
    expect(x.startsWith('<mxfile')).toBe(true);
    expect(x).toContain('<mxGraphModel');
    expect(x).toContain('<root>');
    // the two roots mxGraph requires
    expect(x).toContain('<mxCell id="0"/>');
    expect(x).toContain('<mxCell id="1" parent="0"/>');
  });

  /**
   * PARSE IT FOR REAL. Counting tags passed while the output was invalid XML
   * that draw.io refused to open — an inline style's quote closed the value
   * attribute. A real parser is the only assertion worth making here.
   */
  const dom = new JSDOM('');
  const parse = (x: string): Document => {
    const doc = new dom.window.DOMParser().parseFromString(x, 'application/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error(err.textContent || 'XML parse error');
    return doc as unknown as Document;
  };

  it('is valid XML, parsed rather than counted', () => {
    const doc = parse(xml());
    expect(doc.documentElement.nodeName).toBe('mxfile');
    expect(doc.querySelectorAll('mxCell').length).toBeGreaterThan(3);
  });

  it('every board label survives as a real attribute', () => {
    const doc = parse(xml());
    const values = [...doc.querySelectorAll('mxCell')].map((c) => c.getAttribute('value') || '');
    expect(values.join(' ')).toContain('alpha');
    expect(values.join(' ')).toContain('evidence');
  });

  it('keeps our layout positions so the board opens looking the same', () => {
    /*
     * RELATIVE, not absolute. The board is translated as a whole so nothing
     * sits at a negative coordinate — draw.io's page origin is 0,0 and cells
     * placed before it were clipped off the corner. So what has to hold is
     * that the SHAPE is untouched: every cell moved by the same vector.
     */
    const L = layout(board, m);
    const doc = parse(xml());
    const geoOf = (id: string) => {
      const g = cellById(doc, id).getElementsByTagName('mxGeometry')[0];
      return { x: Number(g.getAttribute('x')), y: Number(g.getAttribute('y')) };
    };
    const a = geoOf('a');
    const b = geoOf('b');
    expect(a.x - b.x).toBe(Math.round(L.byId.a.x) - Math.round(L.byId.b.x));
    expect(a.y - b.y).toBe(Math.round(L.byId.a.y) - Math.round(L.byId.b.y));
    // and the translation is the one the emitter promises
    expect(a.x).toBe(Math.round(L.byId.a.x + 40 - L.bounds.minX));
    expect(a.y).toBe(Math.round(L.byId.a.y + 40 - L.bounds.minY));
  });

  it('emits a cell per element plus the frames', () => {
    const L = layout(board, m);
    const x = xml();
    for (const e of L.elements) expect(x).toContain(`id="${e.id}"`);
    for (const f of L.frames) expect(x).toContain(`id="frame_${f.id}"`);
  });

  it('carries edges with source and target', () => {
    expect(xml()).toMatch(/edge="1"[^>]*source="a"[^>]*target="b"/);
  });

  it('maps shapes to draw.io styles', () => {
    expect(xml()).toMatch(/rhombus/); // the diamond
  });

  it('marks an emphasised node with a heavier stroke', () => {
    expect(xml()).toMatch(/strokeWidth=3/);
  });

  it('uses draw.io sketch rendering by default, and can turn it off', () => {
    expect(xml()).toContain('sketch=1');
    expect(layoutToDrawio(layout(board, m), board.title, p, { sketch: false })).not.toContain('sketch=1');
  });

  it('escapes a label that would otherwise break the XML', () => {
    const nasty: BoardSpec = {
      title: 'x',
      nodes: [{ id: 'a', label: '<script>alert("x")</script> & "quoted"' }]
    };
    const x = layoutToDrawio(layout(nasty, m), nasty.title, p);
    const doc = parse(x); // must still be valid XML
    const value = doc.querySelector('mxCell[vertex="1"]')!.getAttribute('value')!;
    // After XML decoding the label is HTML. The script tag must survive as
    // TEXT, not as markup draw.io would render.
    expect(value).toContain('&lt;script&gt;');
    expect(value).not.toMatch(/<script>/);
  });

  it('escapes the board title', () => {
    const x = layoutToDrawio(layout({ title: 'a "quoted" & <title>' }, m), 'a "quoted" & <title>', p);
    expect(x).toContain('&quot;');
    expect(x).not.toMatch(/name="a "quoted"/);
  });

  it('converts rgb() colours to hex, which draw.io requires', () => {
    const x = xml();
    expect(x).not.toContain('rgb(');
    expect(x).toMatch(/strokeColor=#[0-9a-f]{6}/i);
  });

  it('renders a table as an html label rather than dropping it', () => {
    const x = xml();
    expect(x).toContain('id="t1"');
    expect(x).toContain('&lt;table'); // escaped into the value attribute
  });

  it('includes margin notes as text cells', () => {
    expect(xml()).toContain('id="note_0"');
  });

  it('handles an empty board', () => {
    const x = layoutToDrawio(layout({ title: 'empty' }, m), 'empty', p);
    expect(x).toContain('<mxCell id="1" parent="0"/>');
  });
});

describe('embed url', () => {
  it('defaults to the official embed host with the json protocol', () => {
    const u = resolveEmbedUrl(undefined);
    expect(u).toContain('embed.diagrams.net');
    expect(u).toContain('embed=1');
    expect(u).toContain('proto=json');
  });

  it('honours a self-hosted copy for offline use', () => {
    expect(resolveEmbedUrl('http://127.0.0.1:8080/')).toContain('http://127.0.0.1:8080/?embed=1');
  });

  it('does not double up the query separator', () => {
    expect(resolveEmbedUrl('http://x/?a=1')).toContain('?a=1&embed=1');
  });

  it('follows the editor theme so the canvas does not fight it', () => {
    expect(resolveEmbedUrl(undefined, true)).toContain('dark=1');
    expect(resolveEmbedUrl(undefined, false)).toContain('dark=0');
  });
});

/* Shared with the suite above; a real parser, never tag counting. */
const _dom = new JSDOM('');
const parse = (x: string): Document => {
  const doc = new _dom.window.DOMParser().parseFromString(x, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error(err.textContent || 'XML parse error');
  return doc as unknown as Document;
};
const cellById = (doc: Document, id: string): Element => {
  const c = [...doc.querySelectorAll('mxCell')].find((e) => e.getAttribute('id') === id);
  if (!c) throw new Error(`no cell "${id}" in the emitted xml`);
  return c;
};

describe('what the first real board exposed', () => {
  const bad = (extra: Partial<BoardSpec> = {}): BoardSpec => ({
    title: 'b',
    nodes: [
      { id: 'a', label: 'plain' },
      { id: 'h', label: 'not built yet', hatch: true }
    ],
    annotations: [{ text: 'margin note', at: 'a', place: 'left' }],
    ...extra
  });

  const xmlFor = (spec: BoardSpec, sketch = true) =>
    layoutToDrawio(layout(spec, m), spec.title, p, { sketch });

  it('fills nodes solid, matching SketchyPen — not draw.io hachure', () => {
    const doc = parse(xmlFor(bad()));
    const a = cellById(doc, 'a');
    expect(a.getAttribute('style')).toContain('fillStyle=solid');
    expect(a.getAttribute('style')).not.toContain('fillStyle=hachure');
  });

  it('still hatches a node that asked for it', () => {
    expect(cellById(parse(xmlFor(bad())), 'h').getAttribute('style')).toContain('fillStyle=hachure');
  });

  it('leaves fillStyle alone when sketch rendering is off', () => {
    expect(cellById(parse(xmlFor(bad(), false)), 'a').getAttribute('style')).not.toContain('fillStyle');
  });

  it('translates the board off negative coordinates', () => {
    // A `place: "left"` annotation lands at a negative x, which put it off
    // draw.io's page origin and clipped it.
    const result = layout(bad(), m);
    expect(result.bounds.minX, 'fixture no longer reproduces the negative origin').toBeLessThan(0);

    const doc = parse(xmlFor(bad()));
    const geoms = [...doc.getElementsByTagName('mxGeometry')];
    expect(geoms.length).toBeGreaterThan(0);
    for (const g of geoms) {
      const x = g.getAttribute('x');
      const y = g.getAttribute('y');
      if (x !== null) expect(Number(x), `a cell sits at x=${x}`).toBeGreaterThanOrEqual(0);
      if (y !== null) expect(Number(y), `a cell sits at y=${y}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the board rigid — every cell shifts by the same amount', () => {
    const shifted = parse(xmlFor(bad()));
    const result = layout(bad(), m);
    const node = result.elements.find((e) => e.id === 'a')!;
    const geo = cellById(shifted, 'a').getElementsByTagName('mxGeometry')[0];
    const dx = Number(geo.getAttribute('x')) - Math.round(node.x);
    const dy = Number(geo.getAttribute('y')) - Math.round(node.y);
    expect(dx).toBe(Math.round(40 - result.bounds.minX));
    expect(dy).toBe(Math.round(40 - result.bounds.minY));
  });
});
