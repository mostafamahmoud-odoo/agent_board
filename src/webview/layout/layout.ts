/**
 * The layout stage: `(BoardSpec, TextMeasurer) => LayoutResult`.
 *
 * Pure. No DOM, no rough.js, no theme — colour never affects geometry, which
 * is what lets a theme change redraw without re-laying-out and therefore
 * without losing pan/zoom (FR-023).
 *
 * Ported from media/panel.html:384-507, plus the annotation placement that
 * used to live in drawAnnotation (840-856) and was duplicated — already
 * divergently — in drawSketchy's bounds pass (916-934). It is computed here
 * once (FR-041).
 */

import type { Annotation, BoardNode, BoardSpec, Edge, Frame, Screen, Table, Warning } from '../../shared/types.js';
import { FS_EDGE, FS_NOTE, seedOf, type TextMeasurer, widestLine, wrap } from '../measure/text.js';
import {
  DEFAULT_NODE_W,
  FRAME_GAP,
  FRAME_PAD,
  FRAME_TITLE_H,
  NODE_GAP,
  measureNode,
  measureScreen,
  measureTable,
  normaliseKind,
  normaliseShape
} from './measure-elements.js';
import type {
  Bounds,
  LayoutResult,
  PlacedAnnotation,
  PlacedElement,
  PlacedFrame,
  PlacedLegend,
  RoutedEdge
} from './types.js';

const LEGEND_SWATCH = 18;
const LEGEND_GAP = 14;
const LEGEND_FS = 12;

interface WorkingEl {
  id: string;
  type: 'node' | 'table' | 'screen';
  spec: BoardNode | Table | Screen;
  w: number;
  h: number;
  ox: number;
  oy: number;
  x: number | null;
  y: number | null;
  frameId?: string;
  extra: Record<string, unknown>;
}

export function layout(spec: BoardSpec, m: TextMeasurer): LayoutResult {
  const warnings: Warning[] = [];
  const warn = (code: Warning['code'], path: string, message: string) =>
    warnings.push({ code, path, message });

  /* ---------------------------------------------------------- collect ---- */

  const els: WorkingEl[] = [];
  const byId: Record<string, WorkingEl> = {};

  const add = (o: BoardNode | Table | Screen, type: WorkingEl['type'], idx: number) => {
    if (!o || typeof o !== 'object' || !o.id) {
      warn('schema', `/${type}s/${idx}`, `A ${type} has no id and was skipped.`);
      return;
    }
    if (byId[o.id]) {
      warn('duplicate-id', `/${type}s/${idx}`, `Duplicate element id "${o.id}" — the later one was skipped.`);
      return;
    }
    const el: WorkingEl = {
      id: o.id,
      type,
      spec: o,
      w: 0,
      h: 0,
      ox: 0,
      oy: 0,
      x: null,
      y: null,
      extra: {}
    };
    els.push(el);
    byId[o.id] = el;
  };

  (spec.nodes || []).forEach((n, i) => add(n, 'node', i));
  (spec.tables || []).forEach((t, i) => add(t, 'table', i));
  (spec.screens || []).forEach((s, i) => add(s, 'screen', i));

  const measure = (el: WorkingEl, wHint?: number) => {
    if (el.type === 'table') {
      const mt = measureTable(el.spec as Table, m);
      el.w = mt.w;
      el.h = mt.h;
      el.extra = mt as unknown as Record<string, unknown>;
      return;
    }
    if (el.type === 'screen') {
      const ms = measureScreen(el.spec as Screen, m);
      el.w = ms.w;
      el.h = ms.h;
      el.extra = ms as unknown as Record<string, unknown>;
      return;
    }
    const n = el.spec as BoardNode;
    const mn = measureNode(n, wHint, m);
    el.w = mn.w;
    el.h = mn.h;
    el.extra = mn as unknown as Record<string, unknown>;
  };

  /* ------------------------------------------------------ frame membership */

  const specFrames: Frame[] = (spec.frames || spec.groups || []) as Frame[];
  const frames = specFrames.map((f) => ({
    spec: f,
    id: f.id,
    title: f.title,
    ids: [] as string[],
    flowRow: (f.flow || 'col') === 'row',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    padA: 0,
    padB: 0,
    padL: 0,
    padR: 0,
    r: 0,
    c: 0
  }));
  const frameById: Record<string, (typeof frames)[number]> = {};
  for (const f of frames) frameById[f.id] = f;

  const framed: Record<string, string> = {};
  const order: Record<string, number> = {};
  for (const f of frames) {
    const list = f.spec.items || f.spec.nodes || [];
    list.forEach((id, i) => {
      if (byId[id]) {
        framed[id] = f.id;
        order[id] = i;
      } else {
        warn('dangling-edge', `/frames/${f.id}`, `Frame "${f.id}" lists "${id}", which is not a node, table or screen.`);
      }
    });
  }
  for (const e of els) {
    const declared = (e.spec as { frame?: string }).frame;
    if (declared && framed[e.id] == null) {
      if (frameById[declared]) {
        framed[e.id] = declared;
        order[e.id] = 1e6;
      } else {
        warn('missing-frame', `/${e.type}s/${e.id}`, `"${e.id}" names frame "${declared}", which does not exist.`);
      }
    }
  }

  /* ------------------------------------------------------- intra-frame flow */

  const maxBoard = spec.maxWidth || 1500;
  for (const f of frames) {
    const mine = els
      .filter((e) => framed[e.id] === f.id)
      .sort((a, b) => (order[a.id] || 0) - (order[b.id] || 0));
    f.ids = mine.map((e) => e.id);
    const nodeW = f.spec.nodeWidth || spec.nodeWidth || DEFAULT_NODE_W;
    let cur = 0;
    let cross = 0;
    for (const e of mine) {
      e.frameId = f.id;
      measure(e, nodeW);
      if (f.flowRow) {
        e.ox = cur;
        e.oy = 0;
        cur += e.w + NODE_GAP;
        cross = Math.max(cross, e.h);
      } else {
        e.ox = 0;
        e.oy = cur;
        cur += e.h + NODE_GAP;
        cross = Math.max(cross, e.w);
      }
    }
    cur = Math.max(0, cur - NODE_GAP);
    f.w = (f.flowRow ? cur : cross) + 2 * FRAME_PAD;
    f.h = (f.flowRow ? cross : cur) + 2 * FRAME_PAD + (f.title ? FRAME_TITLE_H : 0);
    // Centre narrow items in a frame widened by a bigger sibling.
    for (const e of mine) {
      if (!f.flowRow && (f.spec.align || spec.align) !== 'start') {
        e.ox = Math.round((f.w - 2 * FRAME_PAD - e.w) / 2);
      }
    }
  }

  /* ------------------------------------- annotation gutters (pre-placement) */

  const rawAnnotations: Annotation[] = ((spec.annotations || spec.notes || []) as Annotation[]).filter(
    (a) => a && typeof a.text === 'string'
  );

  /** Wrapped ONCE and reused by gutter reservation, placement and bounds. */
  const wrapped = rawAnnotations.map((an) => {
    const size = an.size || FS_NOTE;
    const lines = wrap(an.text, an.width || 240, size, m);
    return { an, size, lines, tw: widestLine(lines, size, m) };
  });

  for (const w of wrapped) {
    const { an, size, lines, tw } = w;
    const place = an.place || 'right';
    let f = an.atFrame ? frameById[an.atFrame] : undefined;
    if (!f && an.at && framed[an.at]) f = frameById[framed[an.at]];
    if (!f) continue;
    // Match the painted baseline math or the gutter runs short of the ink.
    const need = lines.length * (size + 4) + size + 22;
    if (place === 'below') f.padB = Math.max(f.padB, need);
    else if (place === 'above') f.padA = Math.max(f.padA, need);
    else if (place === 'left') f.padL = Math.max(f.padL, tw + 30);
    else f.padR = Math.max(f.padR, tw + 30);
  }

  /* --------------------------------------------------------- frame placement */

  const grid = frames.some((f) => f.spec.row != null || f.spec.col != null);
  if (grid) {
    let r = 0;
    let c = 0;
    for (const f of frames) {
      if (f.spec.row == null && f.spec.col == null) {
        f.r = r;
        f.c = c;
        c++;
      } else {
        f.r = f.spec.row == null ? r : f.spec.row;
        f.c = f.spec.col == null ? 0 : f.spec.col;
      }
      r = Math.max(r, f.r);
    }
    const colW: Record<number, number> = {};
    const rowH: Record<number, number> = {};
    for (const f of frames) {
      colW[f.c] = Math.max(colW[f.c] || 0, f.w + f.padL + f.padR);
      rowH[f.r] = Math.max(rowH[f.r] || 0, f.h + f.padA + f.padB);
    }
    const colX: Record<number, number> = {};
    const rowY: Record<number, number> = {};
    let x = 0;
    Object.keys(colW)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((k) => {
        colX[k] = x;
        x += colW[k] + FRAME_GAP;
      });
    let y = 0;
    Object.keys(rowH)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((k) => {
        rowY[k] = y;
        y += rowH[k] + FRAME_GAP;
      });
    for (const f of frames) {
      f.x = colX[f.c] + f.padL;
      f.y = rowY[f.r] + f.padA;
    }
  } else {
    const boardFlow = (spec.layout || 'columns') === 'rows' ? 'rows' : 'columns';
    let bx = 0;
    let by = 0;
    let bandH = 0;
    for (const f of frames) {
      const fullW = f.w + f.padL + f.padR;
      if (boardFlow === 'rows') {
        f.x = f.padL;
        f.y = by + f.padA;
        by += f.h + f.padA + f.padB + FRAME_GAP;
      } else {
        if (bx > 0 && bx + fullW > maxBoard) {
          bx = 0;
          by += bandH + FRAME_GAP;
          bandH = 0;
        }
        f.x = bx + f.padL;
        f.y = by + f.padA;
        bx += fullW + FRAME_GAP;
        bandH = Math.max(bandH, f.h + f.padA + f.padB);
      }
    }
  }

  /* ---------------------------------------------------- absolute positions */

  for (const f of frames) {
    const top = f.y + FRAME_PAD + (f.title ? FRAME_TITLE_H : 0);
    for (const id of f.ids) {
      const e = byId[id];
      e.x = f.x + FRAME_PAD + e.ox;
      e.y = top + e.oy;
    }
  }

  let looseY = frames.length ? Math.max(...frames.map((f) => f.y + f.h)) + FRAME_GAP : 0;
  for (const e of els) {
    if (e.x != null) continue;
    measure(e, (e.spec as BoardNode).w);
    const sx = (e.spec as BoardNode).x;
    const sy = (e.spec as BoardNode).y;
    if (sx != null && sy != null) {
      e.x = sx;
      e.y = sy;
    } else {
      e.x = 0;
      e.y = looseY;
      looseY += e.h + NODE_GAP;
    }
  }

  /* ---------------------------------------------------------- materialise */

  const placedFrames: PlacedFrame[] = frames.map((f) => ({
    id: f.id,
    spec: f.spec,
    title: f.title,
    ids: f.ids,
    flowRow: f.flowRow,
    x: f.x,
    y: f.y,
    w: f.w,
    h: f.h
  }));

  const placed: PlacedElement[] = [];
  const placedById: Record<string, PlacedElement> = {};
  for (const e of els) {
    const base = { id: e.id, x: e.x as number, y: e.y as number, w: e.w, h: e.h, frameId: e.frameId };
    let p: PlacedElement;
    if (e.type === 'node') {
      const n = e.spec as BoardNode;
      const k = normaliseKind(n.kind);
      const sh = normaliseShape(n.shape);
      if (k.unknown) warn('unknown-kind', `/nodes/${n.id}`, `Unknown kind "${String(n.kind)}" — fell back to "base".`);
      if (sh.unknown) warn('unknown-shape', `/nodes/${n.id}`, `Unknown shape "${String(n.shape)}" — fell back to "rect".`);
      p = {
        ...base,
        type: 'node',
        spec: n,
        kind: k.kind,
        shape: sh.shape,
        lines: (e.extra.lines as string[]) || [],
        subLines: (e.extra.subLines as string[]) || []
      };
    } else if (e.type === 'table') {
      const t = e.spec as Table;
      const k = normaliseKind(t.kind);
      if (k.unknown) warn('unknown-kind', `/tables/${t.id}`, `Unknown kind "${String(t.kind)}" — fell back to "base".`);
      p = {
        ...base,
        type: 'table',
        spec: t,
        kind: k.kind,
        columns: e.extra.columns as never,
        rows: e.extra.rows as never,
        capH: e.extra.capH as number,
        tw: e.extra.tw as number
      };
    } else {
      const s = e.spec as Screen;
      const k = normaliseKind(s.kind);
      if (k.unknown) warn('unknown-kind', `/screens/${s.id}`, `Unknown kind "${String(s.kind)}" — fell back to "base".`);
      p = {
        ...base,
        type: 'screen',
        spec: s,
        kind: k.kind,
        groups: e.extra.groups as never,
        table: e.extra.table as never,
        inner: e.extra.inner as number
      };
    }
    placed.push(p);
    placedById[p.id] = p;
  }

  /* --------------------------------------------------------------- edges */

  const edges: RoutedEdge[] = [];
  ((spec.edges || []) as Edge[]).forEach((e, i) => {
    const from = e.from ?? e.source;
    const to = e.to ?? e.target;
    if (!from || !to) {
      warn('schema', `/edges/${i}`, 'Edge has no from/to (or source/target) and was skipped.');
      return;
    }
    if (!placedById[from]) {
      warn('dangling-edge', `/edges/${i}`, `Edge points at "${from}", which does not exist.`);
      return;
    }
    if (!placedById[to]) {
      warn('dangling-edge', `/edges/${i}`, `Edge points at "${to}", which does not exist.`);
      return;
    }
    // Seed from the edge's identity, not its array index: inserting an edge
    // used to reshuffle the wobble of every edge after it.
    const labelText = e.label == null ? '' : String(e.label);
    edges.push({
      spec: e,
      from,
      to,
      seed: seedOf(e.id || `${from}->${to}|${e.label || ''}`),
      kind: normaliseKind(e.kind).kind,
      label: labelText
        ? { text: labelText, w: Math.round(m.width(labelText, FS_EDGE) + 16), h: FS_EDGE + 10 }
        : undefined
    });
  });

  /* --------------------------------------------- annotations, placed ONCE */

  const ownerOf = (id: string) => (framed[id] ? frameById[framed[id]] : null);

  const annotations: PlacedAnnotation[] = [];
  for (const w of wrapped) {
    const { an, size, lines, tw } = w;
    const target = an.at ? placedById[an.at] : undefined;
    if (an.at && !target) {
      warn('dangling-edge', '/annotations', `Annotation anchors to "${an.at}", which does not exist.`);
    }
    const frame = an.atFrame ? placedFrames.find((f) => f.id === an.atFrame) : undefined;
    if (an.atFrame && !frame) {
      warn('missing-frame', '/annotations', `Annotation anchors to frame "${an.atFrame}", which does not exist.`);
    }
    const box = target || frame;
    const owner = target ? ownerOf(target.id) : null;

    let x = an.x;
    let y = an.y;
    let anchor = an.anchor;

    if (box) {
      const place = an.place || 'right';
      if (place === 'below') {
        x = box.x;
        y = box.y + box.h + 22;
        anchor = anchor || 'start';
        // Clamp past the owning frame's edge so a small/last item in a tight
        // frame does not land its note back inside the frame rectangle.
        if (owner) y = Math.max(y, owner.y + owner.h + size + 6);
      } else if (place === 'above') {
        x = box.x;
        y = box.y - 14 - (lines.length - 1) * (size + 4);
        anchor = anchor || 'start';
        if (owner) y = Math.min(y, owner.y - size - 6);
      } else if (place === 'left') {
        x = box.x - 16;
        y = box.y + box.h / 2;
        anchor = anchor || 'end';
      } else {
        x = box.x + box.w + 16;
        y = box.y + box.h / 2;
        anchor = anchor || 'start';
      }
      x = (an.x != null ? an.x : x) + (an.dx || 0);
      y = (an.y != null ? an.y : y) + (an.dy || 0);
    }
    if (x == null || y == null) continue;

    annotations.push({
      spec: an,
      x,
      y,
      anchor: (anchor || 'start') as PlacedAnnotation['anchor'],
      lines,
      size,
      textW: tw,
      seed: seedOf('an' + an.text)
    });
  }

  /* --------------------------------------------------------------- bounds */

  const b: Bounds = { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 };
  const acc = (x: number, y: number, w: number, h: number) => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x + w);
    b.maxY = Math.max(b.maxY, y + h);
  };

  for (const f of placedFrames) acc(f.x, f.y, f.w, f.h);
  for (const e of placed) {
    const badge = e.type === 'node' && (e.spec as BoardNode).badge ? 12 : 0;
    acc(e.x, e.y - badge, e.w, e.h + badge);
  }
  // Edge labels sit at the midpoint of the route and used not to be counted
  // at all, so a label near the board edge could be clipped.
  for (const e of edges) {
    if (!e.label) continue;
    const a = placedById[e.from];
    const bEl = placedById[e.to];
    const mx = (a.x + a.w / 2 + bEl.x + bEl.w / 2) / 2;
    const my = (a.y + a.h / 2 + bEl.y + bEl.h / 2) / 2;
    acc(mx - e.label.w / 2, my - e.label.h, e.label.w, e.label.h);
  }

  // Same resolved positions the renderer will paint — no second computation.
  for (const a of annotations) {
    const left = a.anchor === 'end' ? a.x - a.textW : a.anchor === 'middle' ? a.x - a.textW / 2 : a.x;
    const th = a.lines.length * (a.size + 4) + 10;
    acc(left - 4, a.y - a.size - 4, a.textW + 8, th);
  }

  const empty = b.minX > b.maxX;
  if (empty) {
    b.minX = 0;
    b.minY = -FS_NOTE;
    b.maxX = 300;
    b.maxY = 8;
  }

  /* --------------------------------------------------------------- legend */

  let legend: PlacedLegend | null = null;
  const legendEntries = (spec.legend || []).filter((l) => l && typeof l.label === 'string');
  if (legendEntries.length) {
    let w = 0;
    for (const item of legendEntries) {
      w += LEGEND_SWATCH + 6 + m.width(item.label, LEGEND_FS) + LEGEND_GAP + 8;
    }
    legend = { entries: legendEntries, x: b.minX, y: b.maxY + 22, w, h: 20 };
    // The old code discarded drawLegend's measured width and bumped only maxY,
    // so a long legend overflowed the viewBox horizontally.
    acc(legend.x, legend.y - LEGEND_FS, legend.w, legend.h);
    b.maxY = Math.max(b.maxY, legend.y + legend.h);
  }

  return {
    bounds: b,
    frames: placedFrames,
    elements: placed,
    byId: placedById,
    edges,
    annotations,
    legend,
    warnings,
    empty
  };
}
