/**
 * Element sizing. Ported from media/panel.html:305-376, with the DOM
 * dependency replaced by an injected TextMeasurer and the results returned
 * rather than mutated onto the caller's spec objects.
 */

import type { BoardNode, Cell, Kind, Row, Screen, Shape, Table } from '../../shared/types.js';
import { KINDS, SHAPES } from '../../shared/types.js';
import {
  FS_CELL,
  FS_LABEL,
  FS_SUB,
  LH_LABEL,
  LH_SUB,
  PAD_X,
  PAD_Y,
  type TextMeasurer,
  wrap
} from '../measure/text.js';

export const DEFAULT_NODE_W = 270;
export const NODE_GAP = 20;
export const FRAME_PAD = 16;
export const FRAME_TITLE_H = 30;
export const FRAME_GAP = 34;
export const CELL_H = 26;
export const HEAD_H = 30;
export const CELL_PAD = 10;
export const SCR_PAD = 16;
export const FIELD_H = 24;

/** Unknown values fall back, but the caller is told so it can warn (data-model V7). */
export function normaliseKind(k: unknown): { kind: Kind; unknown: boolean } {
  if (typeof k === 'string' && (KINDS as readonly string[]).includes(k)) {
    return { kind: k as Kind, unknown: false };
  }
  return { kind: 'base', unknown: k != null && k !== '' };
}

export function normaliseShape(s: unknown): { shape: Shape; unknown: boolean } {
  if (typeof s === 'string' && (SHAPES as readonly string[]).includes(s)) {
    return { shape: s as Shape, unknown: false };
  }
  return { shape: 'rect', unknown: s != null && s !== '' };
}

export interface NodeMeasure {
  w: number;
  h: number;
  lines: string[];
  subLines: string[];
}

export function measureNode(n: BoardNode, wHint: number | undefined, m: TextMeasurer): NodeMeasure {
  const w = n.w || wHint || DEFAULT_NODE_W;
  const inner = w - 2 * PAD_X;
  const lines = wrap(n.label != null ? n.label : n.id, inner, FS_LABEL, m);
  const subLines = n.sub ? wrap(n.sub, inner, FS_SUB, m) : [];
  let h = 2 * PAD_Y + lines.length * LH_LABEL + (subLines.length ? subLines.length * LH_SUB + 4 : 0);
  if (n.shape === 'diamond' || n.shape === 'ellipse') h += 16;
  if (n.badge) h += 4;
  return { w, h: Math.max(n.h || 0, Math.round(h)), lines, subLines };
}

export function cellText(c: Cell): string {
  if (c == null) return '';
  if (typeof c === 'object') return String(c.text == null ? '' : c.text);
  return String(c);
}

/**
 * A row is either a bare array of cells or `{ kind, cells }` — the object form
 * is how a whole record gets tinted (the record that is wrong).
 */
export function tableRows(t: Table): { kind: Kind | null; cells: Cell[] }[] {
  return (t.rows || []).map((r: Row) =>
    Array.isArray(r)
      ? { cells: r, kind: null }
      : { cells: r.cells || [], kind: (r.kind as Kind) || null }
  );
}

export interface TableMeasure {
  w: number;
  h: number;
  capH: number;
  tw: number;
  columns: { label?: string; align?: 'left' | 'right'; width?: number; w: number }[];
  rows: { kind: Kind | null; cells: Cell[] }[];
}

export function measureTable(t: Table, m: TextMeasurer): TableMeasure {
  const cols = (t.columns || []).map((c) => (typeof c === 'string' ? { label: c } : { ...c }));
  const rows = tableRows(t);
  const measured = cols.map((c, i) => {
    let w = m.width(c.label || '', FS_CELL, true);
    for (const r of rows) w = Math.max(w, m.width(cellText(r.cells[i]), FS_CELL));
    return { ...c, w: Math.max(c.width || 0, Math.round(w + 2 * CELL_PAD)) };
  });
  const tw = measured.reduce((a, c) => a + c.w, 0);
  const capH = t.title ? 22 : 0;
  return {
    w: Math.max(t.w || 0, tw),
    h: capH + HEAD_H + rows.length * CELL_H,
    capH,
    tw,
    columns: measured,
    rows
  };
}

export interface ScreenMeasure {
  w: number;
  h: number;
  inner: number;
  groups: { def: NonNullable<Screen['groups']>[number]; cols: number; fw: number; h: number }[];
  table: TableMeasure | null;
}

export function measureScreen(s: Screen, m: TextMeasurer): ScreenMeasure {
  const inner0 = (s.width || 660) - 2 * SCR_PAD;
  let inner = inner0;
  let tbl: TableMeasure | null = null;
  if (s.table) {
    tbl = measureTable(s.table, m);
    inner = Math.max(inner, tbl.w);
  }

  let h = SCR_PAD;
  if (s.breadcrumb) h += 18;
  if ((s.buttons && s.buttons.length) || (s.statusbar && s.statusbar.length)) h += 34;
  h += 8;

  const groups = (s.groups || []).map((gr) => {
    const cols = gr.columns || 2;
    const fw = Math.floor((inner - 14 * (cols - 1)) / cols);
    const rows = Math.ceil((gr.fields || []).length / cols);
    const gh = (gr.title ? 20 : 0) + rows * FIELD_H + 10;
    return { def: gr, cols, fw, h: gh };
  });
  for (const g of groups) h += g.h;
  if (tbl) h += tbl.h + 10;
  if (s.footer) h += 20;
  h += SCR_PAD;

  return { w: inner + 2 * SCR_PAD, h: Math.round(h), inner, groups, table: tbl };
}
