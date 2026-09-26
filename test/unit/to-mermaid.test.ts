import { describe, expect, it } from 'vitest';
import type { BoardSpec } from '../../src/shared/types.js';
import { boardToMermaid, canRenderAsMermaid } from '../../src/webview/render/to-mermaid.js';

/**
 * Choosing "Mermaid" on a board made of nodes and frames used to fail with
 * "this board has style mermaid but no code" — the menu offered something
 * that could never work. Mermaid source is derived from the board instead.
 */

const board: BoardSpec = {
  title: 'derive me',
  frames: [{ id: 'f1', title: 'Group one', nodes: ['a', 'b'] }],
  nodes: [
    { id: 'a', label: 'alpha', sub: 'detail' },
    { id: 'b', label: 'beta', shape: 'diamond' },
    { id: 'loose', label: 'ungrouped' }
  ],
  edges: [
    { from: 'a', to: 'b', label: 'link' },
    { from: 'b', to: 'loose', style: 'dotted' }
  ]
};

describe('deriving mermaid from a board', () => {
  it('produces a flowchart', () => {
    expect(boardToMermaid(board).code.startsWith('flowchart TB')).toBe(true);
  });

  it('puts framed nodes in a subgraph and leaves the rest at the top level', () => {
    const { code } = boardToMermaid(board);
    expect(code).toMatch(/subgraph[^\n]*Group one/);
    expect(code).toContain('end');
    // the ungrouped node is declared outside any subgraph
    const afterEnd = code.slice(code.lastIndexOf('end'));
    expect(afterEnd).toContain('ungrouped');
  });

  it('carries edge labels and styles', () => {
    const { code } = boardToMermaid(board);
    expect(code).toMatch(/-->\|"link"\|/);
    expect(code).toContain('-.->');
  });

  it('maps shapes to mermaid brackets', () => {
    expect(boardToMermaid(board).code).toMatch(/\{"beta"\}/);
  });

  it('escapes quotes so a label cannot break the statement', () => {
    const { code } = boardToMermaid({ title: 't', nodes: [{ id: 'a', label: 'say "hi" now' }] });
    expect(code).not.toMatch(/"say "hi" now"/);
    expect(code).toContain("say 'hi' now");
  });

  it('turns newlines into mermaid line breaks, never raw newlines in a label', () => {
    const { code } = boardToMermaid({ title: 't', nodes: [{ id: 'a', label: 'one\ntwo' }] });
    expect(code).toContain('one<br/>two');
    const decl = code.split('\n').find((l) => l.includes('one<br/>two'))!;
    expect(decl.split('"').length).toBe(3); // exactly one quoted label on the line
  });

  it('makes ids mermaid-safe and keeps them unique', () => {
    const { code } = boardToMermaid({
      title: 't',
      nodes: [{ id: 'a-b.c', label: 'x' }, { id: 'a_b_c', label: 'y' }],
      edges: [{ from: 'a-b.c', to: 'a_b_c' }]
    });
    expect(code).not.toMatch(/a-b\.c/);
    const ids = [...code.matchAll(/^\s{2}(\w+)[[{(]/gm)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('drops an edge that points at something not on the board', () => {
    const { code } = boardToMermaid({ title: 't', nodes: [{ id: 'a' }], edges: [{ from: 'a', to: 'ghost' }] });
    expect(code).not.toContain('ghost');
  });

  it('says what it had to leave out', () => {
    const { warnings } = boardToMermaid({
      title: 't',
      nodes: [{ id: 'a' }],
      tables: [{ id: 't1', title: 'rows' }],
      annotations: [{ text: 'a margin note', at: 'a' }]
    });
    expect(warnings.join(' ')).toMatch(/tables and forms/i);
    expect(warnings.join(' ')).toMatch(/margin notes/i);
  });

  it('handles an empty board without producing invalid source', () => {
    const { code } = boardToMermaid({ title: 'empty' });
    expect(code).toContain('flowchart TB');
    expect(code.split('\n').length).toBeGreaterThan(1);
  });
});

describe('when Mermaid is offered at all', () => {
  it('yes for a board with its own code', () =>
    expect(canRenderAsMermaid({ title: 't', style: 'mermaid', code: 'flowchart TB\n a-->b' })).toBe(true));
  it('yes for a board with nodes', () => expect(canRenderAsMermaid(board)).toBe(true));
  it('no for an empty board', () => expect(canRenderAsMermaid({ title: 't' })).toBe(false));
  it('no when there is no board', () => expect(canRenderAsMermaid(null)).toBe(false));
});
