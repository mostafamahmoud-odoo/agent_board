import type { BoardNode, Cell, Kind } from '../../shared/types.js';
import type { LayoutResult, PlacedElement, PlacedFrame, PlacedScreen, PlacedTable } from '../layout/types.js';
import { cellText } from '../layout/measure-elements.js';
import { kindOf, type Palette } from '../theme/palette.js';

/**
 * Turns a laid-out board into mxGraph XML for draw.io.
 *
 * Our layout engine still decides where things go, so a board opens looking
 * like the board Claude drew — draw.io then owns editing. That split is what
 * makes the swap worth it: we keep the part that understands the spec, and
 * hand off the part that is a canvas.
 *
 * draw.io's own `sketch=1` keeps the hand-drawn identity rather than losing it
 * to a generic flowchart look.
 */

/** XML text/attribute escaping. Board content is agent-written; never trust it. */
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * TWO LEVELS OF ESCAPING, and both are needed.
 *
 * A draw.io label lives in `value="..."`, so the whole thing is XML-escaped
 * once. What the XML parser hands back is then rendered as HTML by draw.io.
 * So markup we author is escaped once (`asValue`) and text that came from the
 * board is escaped twice (`t`) — otherwise a label containing `<` or a quote
 * either breaks the XML or injects markup.
 *
 * Getting this half-right is what produced invalid XML that draw.io silently
 * refused to open.
 */

/** Board text, safe to place inside HTML that will itself be XML-escaped. */
function t(s: unknown): string {
  return esc(s);
}

/** A finished HTML fragment, ready to go into an XML attribute. */
function asValue(html: string): string {
  return esc(html);
}

/** Plain text label with line breaks. */
function htmlLabel(s: unknown): string {
  return asValue(t(s).replace(/\n/g, '<br>'));
}

/**
 * `{ rhombus: '' }` is a BARE flag in draw.io's style syntax, not an empty
 * value — dropping it turned every diamond back into a rectangle.
 */
function styleOf(pairs: Record<string, string | number | undefined>): string {
  return Object.entries(pairs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (v === '' ? k : `${k}=${v}`))
    .join(';');
}

/** Our seven kinds, as draw.io fill/stroke/font colours. */
function colours(p: Palette, kind: Kind | undefined) {
  const k = kindOf(p, kind);
  return {
    fillColor: k.f === 'transparent' ? 'none' : toHex(k.f),
    strokeColor: toHex(k.s),
    fontColor: toHex(k.t)
  };
}

/** draw.io wants #rrggbb; our palette may hand back rgb(). */
function toHex(c: string): string {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(c);
  if (!m) return c.startsWith('#') ? c.slice(0, 7) : c;
  const h = (n: string) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0');
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
}

const SHAPE: Record<string, Record<string, string | number>> = {
  rect: { rounded: 0 },
  round: { rounded: 1, arcSize: 12 },
  pill: { rounded: 1, arcSize: 50 },
  ellipse: { ellipse: '' },
  diamond: { rhombus: '' },
  cyl: { shape: 'cylinder3', boundedLbl: 1 },
  note: { shape: 'note', size: 14 }
};

function nodeCell(o: Origin, e: PlacedElement, p: Palette, sketch: boolean, parent = '1'): string {
  const spec = e.type === 'node' ? (e.spec as BoardNode) : undefined;
  const c = colours(p, e.type === 'node' ? e.kind : e.kind);
  const shape = e.type === 'node' ? SHAPE[e.shape] ?? SHAPE.rect : SHAPE.rect;

  const label =
    e.type === 'node'
      ? spec?.sub
        ? asValue(
            `<b>${t(spec.label ?? e.id).replace(/\n/g, '<br>')}</b>` +
              `<br><font style="font-size:10px;opacity:0.75">${t(spec.sub).replace(/\n/g, '<br>')}</font>`
          )
        : htmlLabel(spec?.label ?? e.id)
      : e.type === 'table'
        ? tableLabel(e)
        : screenLabel(e);

  const style = styleOf({
    ...shape,
    whiteSpace: 'wrap',
    html: 1,
    ...c,
    /*
     * FILL STYLE IS NOT OPTIONAL HERE.
     *
     * draw.io's sketch mode defaults to rough.js hachure, so every node came
     * back scribbled over in diagonal lines with its label unreadable
     * underneath. Our own SketchyPen sets `fillStyle = 'solid'` unless the
     * node asks for `hatch` (pen.ts) — this is the same rule, so the two
     * renderers agree instead of one of them deciding to shade everything.
     */
    fillStyle: sketch ? (spec?.hatch === true ? 'hachure' : 'solid') : undefined,
    fontSize: 12,
    strokeWidth: spec?.emphasis ? 3 : 1.5,
    fontStyle: spec?.emphasis ? 1 : undefined,
    dashed: e.type === 'node' && kindOf(p, e.kind).dash ? 1 : undefined,
    dashPattern: e.type === 'node' && kindOf(p, e.kind).dash ? kindOf(p, e.kind).dash!.join(' ') : undefined,
    sketch: sketch ? 1 : undefined,
    curveFitting: sketch ? 1 : undefined,
    jiggle: sketch ? 2 : undefined,
    verticalAlign: 'middle',
    align: 'center'
  });

  return cell(o, e.id, label, style, e.x, e.y, e.w, e.h, parent);
}

/**
 * The little corner chip (`badge: "step 1"`). The sketchy renderer has always
 * drawn it (paint.ts) and the emitter dropped it, so a board lost its step
 * numbers and its "bug" / "new" markers the moment it opened in draw.io.
 */
function badgeCell(o: Origin, e: PlacedElement, p: Palette, sketch: boolean, parent: string): string | null {
  const spec = e.type === 'node' ? (e.spec as BoardNode) : undefined;
  if (!spec?.badge) return null;
  const text = String(spec.badge);
  const w = text.length * 9 * 0.62 + 12;
  const k = kindOf(p, e.kind);
  const style = styleOf({
    rounded: 1,
    arcSize: 50,
    whiteSpace: 'wrap',
    html: 1,
    fillColor: toHex(p.chip),
    fillStyle: sketch ? 'solid' : undefined,
    strokeColor: toHex(k.s),
    fontColor: toHex(k.s),
    fontSize: 9,
    strokeWidth: 1,
    sketch: sketch ? 1 : undefined,
    jiggle: sketch ? 2 : undefined,
    verticalAlign: 'middle',
    align: 'center'
  });
  return cell(o, `badge_${e.id}`, htmlLabel(text), style, e.x + e.w - w - 6, e.y - 10, w, 18, parent);
}

/**
 * A table becomes an html label, which draw.io keeps editable as rich text.
 *
 * The markup is built RAW and escaped once at the end, because it ends up
 * inside `value="..."` — emitting half-escaped markup produced invalid XML
 * that draw.io silently refused to open.
 */
function tableLabel(tb: PlacedTable): string {
  const cellHtml = (txt: string, align: string, bold: boolean) =>
    `<td style="text-align:${align};padding:2px 6px">${bold ? `<b>${txt}</b>` : txt}</td>`;

  const head = tb.columns
    .map((c) => `<th style="text-align:${c.align === 'right' ? 'right' : 'left'};padding:2px 6px">${t(c.label ?? '')}</th>`)
    .join('');
  const rows = tb.rows
    .map(
      (r) =>
        `<tr>${r.cells
          .map((cl, i) => {
            const obj = cl && typeof cl === 'object' ? (cl as { bold?: boolean }) : null;
            return cellHtml(t(cellText(cl as Cell)), tb.columns[i]?.align === 'right' ? 'right' : 'left', obj?.bold === true);
          })
          .join('')}</tr>`
    )
    .join('');
  const caption = tb.spec.title ? `<div style="font-weight:600;margin-bottom:3px">${t(tb.spec.title)}</div>` : '';
  const html =
    `${caption}<table style="border-collapse:collapse;font-size:10px">` +
    `<thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  return asValue(html);
}

function screenLabel(s: PlacedScreen): string {
  const parts: string[] = [];
  if (s.spec.breadcrumb) parts.push(`<div style="opacity:.7;font-size:10px">${t(s.spec.breadcrumb)}</div>`);
  for (const g of s.groups) {
    if (g.def.title) parts.push(`<div style="font-weight:600;margin-top:4px">${t(g.def.title)}</div>`);
    for (const f of g.def.fields ?? []) {
      parts.push(`<div style="font-size:10px">${t(f.label ?? '')}: <b>${t(f.value ?? '')}</b></div>`);
    }
  }
  if (s.spec.footer) parts.push(`<div style="opacity:.7;font-size:10px;margin-top:4px">${t(s.spec.footer)}</div>`);
  return asValue(parts.join('') || t(s.id));
}

/**
 * THE ORIGIN SHIFT.
 *
 * Our layout is free to use negative coordinates — a `place: "left"`
 * annotation beside the leftmost frame lands at a negative x, and that is
 * normal for an SVG we pan ourselves. draw.io's page origin is 0,0 and it
 * opens near it, so those cells sat off the top-left corner: the margin notes
 * were clipped and the board looked shoved off the canvas.
 *
 * So every cell is emitted through this, which translates the whole board to
 * start at MARGIN,MARGIN. Nothing else needs to know about it.
 */
const MARGIN = 40;

interface Origin {
  dx: number;
  dy: number;
}

function cell(
  o: Origin,
  id: string,
  value: string,
  style: string,
  x: number,
  y: number,
  w: number,
  h: number,
  parent = '1'
): string {
  return (
    `<mxCell id="${esc(id)}" value="${value}" style="${esc(style)}" vertex="1" parent="${parent}">` +
    `<mxGeometry x="${Math.round(x + o.dx)}" y="${Math.round(y + o.dy)}" ` +
    `width="${Math.round(w)}" height="${Math.round(h)}" as="geometry"/>` +
    `</mxCell>`
  );
}

export interface DrawioOptions {
  /** Keep the hand-drawn look using draw.io's own sketch rendering. */
  sketch?: boolean;
}

export function layoutToDrawio(
  layout: LayoutResult,
  title: string,
  p: Palette,
  opts: DrawioOptions = {}
): string {
  const sketch = opts.sketch !== false;
  const { minX, minY, maxX, maxY } = layout.bounds;
  const o: Origin = { dx: MARGIN - minX, dy: MARGIN - minY };
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];

  /*
   * WHICH FRAME OWNS WHICH ELEMENT.
   *
   * The frame cells were emitted with `container=1` and a comment claiming
   * dragging a frame takes its contents along — but every element was
   * emitted with parent="1", so it did nothing. Moving a frame left its
   * nodes behind. Elements are now real children of their frame, with
   * geometry relative to it, which is what mxGraph containment means.
   */
  const ownerOf = new Map<string, PlacedFrame>();
  for (const f of layout.frames) for (const id of f.ids) ownerOf.set(id, f);

  // Frames first so they sit behind their contents.
  for (const f of layout.frames) {
    const style = styleOf({
      rounded: 1,
      arcSize: 4,
      whiteSpace: 'wrap',
      html: 1,
      fillColor: 'none',
      fillStyle: sketch ? 'solid' : undefined,
      strokeColor: toHex(p.frameStroke),
      dashed: 1,
      dashPattern: '8 6',
      verticalAlign: 'top',
      align: 'left',
      spacingLeft: 8,
      spacingTop: 4,
      fontColor: toHex(p.frameTitle),
      fontSize: 12,
      fontStyle: 1,
      sketch: sketch ? 1 : undefined,
      curveFitting: sketch ? 1 : undefined,
      jiggle: sketch ? 2 : undefined,
      // A container so dragging the frame takes its contents along.
      container: 1,
      collapsible: 0,
      childLayout: 'none'
    });
    cells.push(cell(o, `frame_${f.id}`, htmlLabel(f.title ?? ''), style, f.x, f.y, f.w, f.h));
  }

  for (const e of layout.elements) {
    const owner = ownerOf.get(e.id);
    // A child's geometry is relative to its parent, so the origin shift is
    // already carried by the frame and must not be applied twice.
    const eo: Origin = owner ? { dx: -owner.x, dy: -owner.y } : o;
    cells.push(nodeCell(eo, e, p, sketch, owner ? `frame_${owner.id}` : '1'));
    const badge = badgeCell(eo, e, p, sketch, owner ? `frame_${owner.id}` : '1');
    if (badge) cells.push(badge);
  }

  for (const e of layout.edges) {
    const kc = kindOf(p, e.kind);
    const dash = e.spec.style === 'dashed' ? '8 6' : e.spec.style === 'dotted' ? '2 4' : undefined;
    const style = styleOf({
      edgeStyle: 'orthogonalEdgeStyle',
      rounded: 1,
      html: 1,
      strokeColor: toHex(e.spec.color || (e.spec.kind ? kc.s : p.edge)),
      strokeWidth: e.spec.emphasis ? 3 : 1.5,
      dashed: dash ? 1 : undefined,
      dashPattern: dash,
      endArrow: e.spec.arrow === false ? 'none' : 'blockThin',
      endFill: e.spec.arrow === false ? undefined : 1,
      fontSize: 10,
      fontColor: toHex(p.muted),
      sketch: sketch ? 1 : undefined,
      jiggle: sketch ? 2 : undefined
    });
    cells.push(
      `<mxCell id="edge_${esc(e.from)}_${esc(e.to)}" value="${htmlLabel(e.spec.label ?? '')}" ` +
        `style="${esc(style)}" edge="1" parent="1" source="${esc(e.from)}" target="${esc(e.to)}">` +
        `<mxGeometry relative="1" as="geometry"/></mxCell>`
    );
  }

  // Margin notes become free text, positioned where layout put them.
  layout.annotations.forEach((a, i) => {
    const colour = toHex(a.spec.color || (a.spec.kind ? kindOf(p, a.spec.kind).s : p.ink));
    const style = styleOf({
      text: '',
      html: 1,
      whiteSpace: 'wrap',
      fontSize: Math.round(a.size),
      fontColor: colour,
      align: a.anchor === 'end' ? 'right' : a.anchor === 'middle' ? 'center' : 'left',
      verticalAlign: 'top',
      strokeColor: 'none',
      fillColor: 'none'
    });
    const w = Math.max(60, a.textW + 10);
    const x = a.anchor === 'end' ? a.x - w : a.anchor === 'middle' ? a.x - w / 2 : a.x;
    cells.push(
      cell(o, `note_${i}`, htmlLabel(a.spec.text), style, x, a.y - a.size, w, a.lines.length * (a.size + 4) + 6)
    );

    // `underline: true` is a whiteboard gesture the sketchy renderer draws as
    // a wobbly rule under the text; here it is a hairline of the same colour.
    if (a.spec.underline) {
      const y2 = a.y + (a.lines.length - 1) * (a.size + 4) + 5;
      const x0 = a.anchor === 'end' ? a.x - a.textW : a.anchor === 'middle' ? a.x - a.textW / 2 : a.x;
      const rule = styleOf({
        line: '',
        strokeWidth: 1.2,
        strokeColor: colour,
        sketch: sketch ? 1 : undefined,
        jiggle: sketch ? 2 : undefined
      });
      cells.push(cell(o, `note_${i}_rule`, '', rule, x0, y2, Math.max(8, a.textW), 1));
    }
  });

  /*
   * THE LEGEND. Laid out, measured, counted in bounds — and then silently
   * dropped by this emitter, so a board that explained its own colours in
   * sketchy opened in draw.io with the colours unexplained. Same geometry the
   * sketchy renderer uses (paint.ts), so the two agree.
   */
  if (layout.legend) {
    let lx = layout.legend.x;
    const ly = layout.legend.y;
    layout.legend.entries.forEach((item, i) => {
      const k = kindOf(p, item.kind);
      const swatch = styleOf({
        rounded: 0,
        html: 1,
        fillColor: k.f === 'transparent' ? 'none' : toHex(k.f),
        fillStyle: sketch ? 'solid' : undefined,
        strokeColor: toHex(k.s),
        strokeWidth: 1.1,
        dashed: k.dash ? 1 : undefined,
        dashPattern: k.dash ? k.dash.join(' ') : undefined,
        sketch: sketch ? 1 : undefined,
        jiggle: sketch ? 2 : undefined
      });
      cells.push(cell(o, `legend_sw_${i}`, '', swatch, lx, ly - 10, 18, 12));

      const labelW = item.label.length * 12 * 0.55;
      const text = styleOf({
        text: '',
        html: 1,
        whiteSpace: 'wrap',
        fontSize: 12,
        fontColor: toHex(p.muted),
        align: 'left',
        verticalAlign: 'middle',
        strokeColor: 'none',
        fillColor: 'none'
      });
      cells.push(cell(o, `legend_tx_${i}`, htmlLabel(item.label), text, lx + 24, ly - 12, labelW + 8, 16));
      lx += 24 + labelW + 22;
    });
  }

  const model =
    `<mxGraphModel dx="${Math.round(maxX - minX)}" dy="${Math.round(maxY - minY)}" grid="1" gridSize="10" ` +
    `guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0">` +
    `<root>${cells.join('')}</root></mxGraphModel>`;

  return (
    `<mxfile host="claude-notes-panel" type="embed">` +
    `<diagram id="board" name="${esc(title)}">${model}</diagram></mxfile>`
  );
}
