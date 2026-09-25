import type { BoardNode, Cell } from '../../shared/types.js';
import type { LayoutResult, PlacedElement, PlacedNode, PlacedScreen, PlacedTable } from '../layout/types.js';
import { kindOf, type Palette } from '../theme/palette.js';
import {
  CELL_H,
  CELL_PAD,
  FIELD_H,
  FRAME_PAD,
  FRAME_TITLE_H,
  HEAD_H,
  SCR_PAD,
  cellText
} from '../layout/measure-elements.js';
import {
  FS_CELL,
  FS_EDGE,
  FS_LABEL,
  FS_SCR,
  FS_SUB,
  FS_TITLE,
  INK_FONT,
  LH_LABEL,
  LH_SUB,

  seedOf
} from '../measure/text.js';
import { el, lines as svgLines, text as svgText } from './svg.js';
import type { Pen, Stroke } from './pen.js';
import { frameSvg, type RenderOptions } from './renderer.js';

/**
 * ONE drawing pass, parameterised by a Pen.
 *
 * This is what makes FR-017 ("identical geometry across styles") true by
 * construction rather than by discipline: sketchy and clean run this exact
 * code and differ only in how a stroke is produced.
 */

const SKETCH_FONT = INK_FONT;
const CLEAN_FONT = 'var(--vscode-font-family), system-ui, sans-serif';

export function paint(
  layout: LayoutResult,
  p: Palette,
  pen: Pen,
  host: SVGSVGElement,
  opts: RenderOptions = {}
): SVGSVGElement {
  const g = el('g');
  const font = pen.id === 'sketchy' ? SKETCH_FONT : CLEAN_FONT;
  const ink = (o: Partial<Parameters<typeof svgText>[4]> & { size: number; fill: string }) => ({
    family: font,
    ...o
  });

  if (layout.empty) {
    svgText(g, '(empty board — no nodes in the spec)', 0, 0, ink({ size: 14, fill: p.frameTitle, anchor: 'start', opacity: 0.8 }));
    host.appendChild(g);
    return frameSvg(g, layout, opts.margin);
  }

  /* frames first, so everything else sits on top */
  for (const f of layout.frames) {
    const stroke: Stroke = {
      stroke: f.spec.color || p.frameStroke,
      fill: p.frameFill,
      width: 1.1,
      seed: seedOf('f' + f.id),
      opacity: 0.95
    };
    pen.roundRect(g, f.x, f.y, f.w, f.h, 10, stroke);
    if (f.title) {
      svgText(
        g,
        f.title,
        f.x + FRAME_PAD,
        f.y + FRAME_TITLE_H - 8,
        ink({ size: FS_TITLE, fill: f.spec.titleColor || p.frameTitle, anchor: 'start', bold: true })
      );
    }
  }

  /* edges under the boxes */
  for (const e of layout.edges) {
    const a = layout.byId[e.from];
    const b = layout.byId[e.to];
    if (!a || !b) continue;
    const kc = kindOf(p, e.kind);
    const color = e.spec.color || (e.spec.kind ? kc.s : p.edge);
    const dash =
      e.spec.style === 'dashed' ? [8, 6] : e.spec.style === 'dotted' ? [1.5, 5] : null;
    const width = (e.spec.emphasis ? 2.4 : 1.5) * 1;
    const [pa, pb] = anchors(a, b);
    const pts = elbow(pa, pb);
    pen.polyline(g, pts, { stroke: color, width, dash, seed: e.seed });
    if (e.spec.arrow !== false) arrowHead(pen, g, pts[pts.length - 2], pts[pts.length - 1], color, e.seed, width);
    if (e.spec.label) {
      const mid = pts[Math.floor(pts.length / 2)];
      const label = String(e.spec.label);
      const tw = label.length * FS_EDGE * 0.55 + 10;
      // A chip behind the label so it stays readable where it crosses a line.
      pen.rect(g, mid[0] - tw / 2, mid[1] - FS_EDGE, tw, FS_EDGE + 8, {
        stroke: 'transparent',
        fill: p.chip,
        width: 0,
        seed: e.seed
      });
      svgText(g, label, mid[0], mid[1] - 1, ink({ size: FS_EDGE, fill: p.muted, anchor: 'middle' }));
    }
  }

  /* elements */
  for (const e of layout.elements) {
    const eg = el('g');
    eg.setAttribute('data-element-id', e.id);
    if (e.type === 'node') drawNode(eg, e, p, pen, font);
    else if (e.type === 'table') drawTable(eg, e, p, pen, font);
    else drawScreen(eg, e, p, pen, font);
    g.appendChild(eg);
    opts.onElement?.(eg, e);
  }

  /* annotations — positions already resolved by layout */
  for (const a of layout.annotations) {
    const color = a.spec.color || (a.spec.kind ? kindOf(p, a.spec.kind).s : p.ink);
    svgLines(g, a.lines, a.x, a.y, a.size + 4, {
      size: a.size,
      fill: color,
      anchor: a.anchor,
      rotate: a.spec.rotate,
      opacity: a.spec.opacity ?? 0.95,
      family: font
    });
    if (a.spec.arrowTo && layout.byId[a.spec.arrowTo]) {
      const t = layout.byId[a.spec.arrowTo];
      const tx = t.x + t.w / 2;
      const ty = t.y + t.h / 2;
      pen.line(g, a.x, a.y + 4, tx, ty, { stroke: color, width: 1.2, dash: [6, 5], seed: a.seed });
      arrowHead(pen, g, [a.x, a.y + 4], [tx, ty], color, a.seed, 1.2);
    }
    if (a.spec.underline) {
      const y2 = a.y + (a.lines.length - 1) * (a.size + 4) + 5;
      const x0 = a.anchor === 'end' ? a.x - a.textW : a.anchor === 'middle' ? a.x - a.textW / 2 : a.x;
      pen.line(g, x0, y2, x0 + a.textW, y2, { stroke: color, width: 1.2, seed: a.seed + 1 });
    }
  }

  /* legend */
  if (layout.legend) {
    let x = layout.legend.x;
    const y = layout.legend.y;
    for (const item of layout.legend.entries) {
      const kc = kindOf(p, item.kind);
      pen.rect(g, x, y - 10, 18, 12, { stroke: kc.s, fill: kc.f, width: 1.1, dash: kc.dash, seed: seedOf('lg' + item.label) });
      svgText(g, item.label, x + 24, y, ink({ size: 12, fill: p.muted, anchor: 'start' }));
      x += 24 + item.label.length * 12 * 0.55 + 22;
    }
  }

  host.appendChild(g);
  return frameSvg(g, layout, opts.margin);
}

/* ------------------------------------------------------------------ */

function drawNode(g: SVGGElement, n: PlacedNode, p: Palette, pen: Pen, font: string): void {
  const spec = n.spec as BoardNode;
  const kc = kindOf(p, n.kind);
  const s: Stroke = {
    stroke: spec.color || kc.s,
    fill: spec.fill || kc.f,
    width: (spec.emphasis ? 2.4 : 1.4) * kc.weight,
    dash: kc.dash,
    seed: seedOf(n.id),
    hatch: spec.hatch === true
  };
  const { x, y, w, h } = n;

  switch (n.shape) {
    case 'ellipse':
      pen.ellipse(g, x + w / 2, y + h / 2, w, h, s);
      break;
    case 'diamond':
      pen.polygon(g, [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]], s);
      break;
    case 'pill':
      pen.roundRect(g, x, y, w, h, Math.min(h / 2, 24), s);
      break;
    case 'round':
      pen.roundRect(g, x, y, w, h, 12, s);
      break;
    case 'cyl': {
      const ry = Math.min(12, h / 5);
      pen.path(
        g,
        `M${x} ${y + ry} a${w / 2} ${ry} 0 0 1 ${w} 0 L${x + w} ${y + h - ry} a${w / 2} ${ry} 0 0 1 ${-w} 0 Z`,
        s
      );
      pen.path(g, `M${x} ${y + ry} a${w / 2} ${ry} 0 0 0 ${w} 0`, { ...s, fill: undefined });
      break;
    }
    case 'note': {
      const fold = 14;
      pen.polygon(
        g,
        [[x, y], [x + w - fold, y], [x + w, y + fold], [x + w, y + h], [x, y + h]],
        s
      );
      pen.polyline(g, [[x + w - fold, y], [x + w - fold, y + fold], [x + w, y + fold]], { ...s, fill: undefined });
      break;
    }
    default:
      pen.rect(g, x, y, w, h, s);
  }

  const textFill = spec.textColor || kc.t;
  const cx = x + w / 2;
  const totalH = n.lines.length * LH_LABEL + (n.subLines.length ? n.subLines.length * LH_SUB + 4 : 0);
  let baseline = y + (h - totalH) / 2 + FS_LABEL;
  svgLines(g, n.lines, cx, baseline, LH_LABEL, {
    size: FS_LABEL,
    fill: textFill,
    anchor: 'middle',
    bold: spec.emphasis === true,
    family: font
  });
  if (n.subLines.length) {
    baseline += n.lines.length * LH_LABEL + 2;
    svgLines(g, n.subLines, cx, baseline, LH_SUB, {
      size: FS_SUB,
      fill: textFill,
      anchor: 'middle',
      opacity: 0.72,
      family: font
    });
  }

  if (spec.badge) {
    const bw = String(spec.badge).length * 9 * 0.62 + 12;
    pen.roundRect(g, x + w - bw - 6, y - 10, bw, 18, 9, {
      stroke: kc.s,
      fill: p.chip,
      width: 1,
      seed: seedOf('b' + n.id)
    });
    svgText(g, String(spec.badge), x + w - bw / 2 - 6, y + 3, {
      size: 9.5,
      fill: kc.s,
      anchor: 'middle',
      family: font
    });
  }
}

function drawTable(g: SVGGElement, t: PlacedTable, p: Palette, pen: Pen, font: string): void {
  const kc = kindOf(p, t.kind);
  const { x, y, w, h } = t;
  pen.rect(g, x, y + t.capH, w, h - t.capH, {
    stroke: t.spec.color || kc.s,
    fill: p.chip,
    width: 1.2,
    seed: seedOf(t.id)
  });

  if (t.spec.title) {
    svgText(g, t.spec.title, x, y + 12, { size: FS_TITLE, fill: p.frameTitle, anchor: 'start', bold: true, family: font });
  }

  const top = y + t.capH;
  // header rule
  pen.line(g, x, top + HEAD_H, x + w, top + HEAD_H, { stroke: kc.s, width: 1.2, seed: seedOf(t.id + 'h') });

  let cx = x;
  for (const c of t.columns) {
    const right = (c.align || 'left') === 'right';
    const tx = right ? cx + c.w - CELL_PAD : cx + CELL_PAD;
    svgText(g, c.label || '', tx, top + 19, {
      size: FS_CELL,
      fill: p.frameTitle,
      anchor: right ? 'end' : 'start',
      bold: true,
      family: font
    });
    t.rows.forEach((r, ri) => {
      const cell = r.cells[t.columns.indexOf(c)] as Cell;
      const obj = cell && typeof cell === 'object' ? cell : null;
      const rowKind = obj?.kind ?? r.kind ?? undefined;
      const fill = rowKind ? kindOf(p, rowKind).s : p.ink;
      svgText(g, cellText(cell), tx, top + HEAD_H + ri * CELL_H + 17, {
        size: FS_CELL,
        fill,
        anchor: right ? 'end' : 'start',
        bold: obj?.bold === true,
        opacity: obj?.dim ? 0.55 : 1,
        family: font
      });
    });
    cx += c.w;
  }

  t.rows.forEach((r, i) => {
    const ry = top + HEAD_H + i * CELL_H;
    if (i > 0) {
      pen.line(g, x, ry, x + w, ry, { stroke: p.muted, width: 0.7, opacity: 0.4, seed: seedOf(t.id + 'r' + i) });
    }
    if (r.kind) {
      const rk = kindOf(p, r.kind);
      pen.rect(g, x, ry, w, CELL_H, { stroke: 'transparent', fill: rk.f, width: 0, opacity: 0.5, seed: seedOf(t.id + 'k' + i) });
    }
  });
}

function drawScreen(g: SVGGElement, s: PlacedScreen, p: Palette, pen: Pen, font: string): void {
  const kc = kindOf(p, s.kind);
  const { x, y, w, h } = s;
  pen.roundRect(g, x, y, w, h, 8, {
    stroke: s.spec.color || kc.s,
    fill: p.chip,
    width: 1.3,
    seed: seedOf(s.id)
  });

  let cy = y + SCR_PAD;
  if (s.spec.breadcrumb) {
    svgText(g, s.spec.breadcrumb, x + SCR_PAD, cy + 8, { size: FS_SCR, fill: p.muted, anchor: 'start', family: font });
    cy += 18;
  }

  if ((s.spec.buttons && s.spec.buttons.length) || (s.spec.statusbar && s.spec.statusbar.length)) {
    let bx = x + SCR_PAD;
    for (const b of s.spec.buttons || []) {
      const def = typeof b === 'string' ? { label: b } : b;
      const label = def.label || '';
      const bw = label.length * FS_SCR * 0.6 + 20;
      const bk = kindOf(p, def.kind);
      pen.roundRect(g, bx, cy, bw, 24, 5, {
        stroke: bk.s,
        fill: def.primary ? bk.s : undefined,
        width: 1.1,
        seed: seedOf(s.id + label)
      });
      svgText(g, label, bx + bw / 2, cy + 16, {
        size: FS_SCR,
        fill: def.primary ? p.chip : bk.s,
        anchor: 'middle',
        family: font
      });
      bx += bw + 8;
    }
    let sx = x + w - SCR_PAD;
    for (const st of (s.spec.statusbar || []).slice().reverse()) {
      const def = typeof st === 'string' ? { label: st } : st;
      const label = def.label || '';
      const bw = label.length * FS_SCR * 0.6 + 18;
      const sk = kindOf(p, def.kind);
      sx -= bw;
      pen.roundRect(g, sx, cy, bw, 24, 12, {
        stroke: def.active ? sk.s : p.muted,
        fill: def.active ? sk.f : undefined,
        width: def.active ? 1.4 : 1,
        seed: seedOf(s.id + 'st' + label)
      });
      svgText(g, label, sx + bw / 2, cy + 16, {
        size: FS_SCR,
        fill: def.active ? sk.s : p.muted,
        anchor: 'middle',
        family: font
      });
      sx -= 6;
    }
    cy += 34;
  }
  cy += 8;

  for (const gr of s.groups) {
    if (gr.def.title) {
      svgText(g, gr.def.title, x + SCR_PAD, cy + 12, { size: FS_SCR, fill: p.frameTitle, anchor: 'start', bold: true, family: font });
      cy += 20;
    }
    (gr.def.fields || []).forEach((f, i) => {
      const col = i % gr.cols;
      const row = Math.floor(i / gr.cols);
      const fx = x + SCR_PAD + col * (gr.fw + 14);
      const fy = cy + row * FIELD_H + 12;
      svgText(g, String(f.label ?? ''), fx, fy, { size: FS_SCR, fill: p.muted, anchor: 'start', family: font });
      const fk = f.kind ? kindOf(p, f.kind).s : p.ink;
      svgText(g, String(f.value ?? ''), fx + gr.fw, fy, {
        size: FS_SCR,
        fill: fk,
        anchor: 'end',
        bold: f.emphasis === true,
        family: font
      });
    });
    cy += gr.h - (gr.def.title ? 20 : 0);
  }

  if (s.table) {
    const t = s.table as unknown as PlacedTable;
    drawTable(g, { ...t, id: s.id + '-tbl', type: 'table', x: x + SCR_PAD, y: cy, w: s.inner, h: t.h, kind: s.kind, spec: s.spec.table! } as PlacedTable, p, pen, font);
    cy += t.h + 10;
  }

  if (s.spec.footer) {
    svgText(g, s.spec.footer, x + SCR_PAD, cy + 12, { size: FS_SCR, fill: p.muted, anchor: 'start', opacity: 0.8, family: font });
  }
}

/* ------------------------------------------------------------- edges */

type Pt = [number, number];

function anchors(a: PlacedElement, b: PlacedElement): [Pt, Pt] {
  const ac: Pt = [a.x + a.w / 2, a.y + a.h / 2];
  const bc: Pt = [b.x + b.w / 2, b.y + b.h / 2];
  const dx = bc[0] - ac[0];
  const dy = bc[1] - ac[1];
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0
      ? [[a.x + a.w, ac[1]], [b.x, bc[1]]]
      : [[a.x, ac[1]], [b.x + b.w, bc[1]]];
  }
  return dy > 0 ? [[ac[0], a.y + a.h], [bc[0], b.y]] : [[ac[0], a.y], [bc[0], b.y + b.h]];
}

function elbow(p: Pt, q: Pt): Pt[] {
  if (Math.abs(p[1] - q[1]) < 2 || Math.abs(p[0] - q[0]) < 2) return [p, q];
  if (Math.abs(q[1] - p[1]) > Math.abs(q[0] - p[0])) {
    const my = (p[1] + q[1]) / 2;
    return [p, [p[0], my], [q[0], my], q];
  }
  const mx = (p[0] + q[0]) / 2;
  return [p, [mx, p[1]], [mx, q[1]], q];
}

function arrowHead(pen: Pen, g: SVGGElement, from: Pt, to: Pt, color: string, seed: number, width: number): void {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const len = 10;
  const spread = 0.42;
  pen.line(g, to[0], to[1], to[0] - len * Math.cos(ang - spread), to[1] - len * Math.sin(ang - spread), {
    stroke: color,
    width,
    seed
  });
  pen.line(g, to[0], to[1], to[0] - len * Math.cos(ang + spread), to[1] - len * Math.sin(ang + spread), {
    stroke: color,
    width,
    seed: seed + 1
  });
}
