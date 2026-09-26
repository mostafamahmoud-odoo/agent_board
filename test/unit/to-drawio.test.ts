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
    const L = layout(board, m);
    const x = xml();
    const a = L.byId.a;
    expect(x).toContain(`x="${Math.round(a.x)}"`);
    expect(x).toContain(`y="${Math.round(a.y)}"`);
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
