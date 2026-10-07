import type { BoardSpec } from '../../shared/types.js';
import type { LayoutResult, PlacedElement } from '../layout/types.js';
import { cellText } from '../layout/measure-elements.js';

/**
 * The board as text (FR-027).
 *
 * Generated from LayoutResult, NOT from the spec, so reading order matches
 * visual order — frames in laid-out order, elements in flow order. A
 * description built from the spec would announce declaration order, which is
 * arbitrary.
 *
 * Also exposed as `Agent Board: Copy Board as Text`, so the accessible path
 * is exercised by sighted users too and is far less likely to rot.
 */

export function describeElement(e: PlacedElement): string {
  if (e.type === 'node') {
    const bits = [e.lines.join(' ')];
    if (e.subLines.length) bits.push(`(${e.subLines.join(' ')})`);
    const spec = e.spec;
    const tags: string[] = [];
    if (e.kind !== 'base') tags.push(e.kind);
    if (spec.shape && spec.shape !== 'rect') tags.push(spec.shape);
    if (spec.badge) tags.push(`badge: ${spec.badge}`);
    if (spec.emphasis) tags.push('emphasised');
    if (spec.hatch) tags.push('hatched');
    if (tags.length) bits.push(`[${tags.join(', ')}]`);
    return bits.join(' ');
  }

  if (e.type === 'table') {
    const head = e.columns.map((c) => c.label || '').join(' | ');
    const rows = e.rows.map((r) => {
      const cells = r.cells.map((c) => cellText(c as never)).join(' | ');
      return r.kind ? `${cells}  [${r.kind}]` : cells;
    });
    return [
      `Table${e.spec.title ? ` "${e.spec.title}"` : ''}: ${e.columns.length} columns, ${e.rows.length} rows`,
      head ? `  Columns: ${head}` : '',
      ...rows.map((r) => `  Row: ${r}`)
    ]
      .filter(Boolean)
      .join('\n');
  }

  const s = e.spec;
  const out: string[] = [`Form${s.breadcrumb ? ` "${s.breadcrumb}"` : ''}`];
  if (s.buttons?.length) {
    out.push(`  Buttons: ${s.buttons.map((b) => (typeof b === 'string' ? b : b.label)).join(', ')}`);
  }
  if (s.statusbar?.length) {
    out.push(
      `  Status: ${s.statusbar
        .map((b) => (typeof b === 'string' ? b : `${b.label}${b.active ? ' (current)' : ''}`))
        .join(' → ')}`
    );
  }
  for (const gr of e.groups) {
    if (gr.def.title) out.push(`  ${gr.def.title}:`);
    for (const f of gr.def.fields || []) out.push(`    ${f.label ?? ''}: ${f.value ?? ''}`);
  }
  if (s.footer) out.push(`  ${s.footer}`);
  return out.join('\n');
}

export function describe(layout: LayoutResult, spec: BoardSpec): string {
  const out: string[] = [];
  out.push(`Board: ${spec.title}`);
  out.push(
    `${layout.frames.length} group${layout.frames.length === 1 ? '' : 's'}, ` +
      `${layout.elements.length} item${layout.elements.length === 1 ? '' : 's'}, ` +
      `${layout.edges.length} connection${layout.edges.length === 1 ? '' : 's'}.`
  );
  out.push('');

  const placed = new Set<string>();
  for (const f of layout.frames) {
    out.push(`Group: ${f.title || f.id}`);
    for (const id of f.ids) {
      const e = layout.byId[id];
      if (!e) continue;
      placed.add(id);
      out.push(indent(describeElement(e), '  - '));
    }
    out.push('');
  }

  const loose = layout.elements.filter((e) => !placed.has(e.id));
  if (loose.length) {
    out.push('Ungrouped:');
    for (const e of loose) out.push(indent(describeElement(e), '  - '));
    out.push('');
  }

  if (layout.edges.length) {
    out.push('Connections:');
    for (const e of layout.edges) {
      const a = layout.byId[e.from];
      const b = layout.byId[e.to];
      const label = e.spec.label ? ` — ${e.spec.label}` : '';
      out.push(`  - ${name(a)} → ${name(b)}${label}`);
    }
    out.push('');
  }

  if (layout.annotations.length) {
    out.push('Notes in the margin:');
    for (const a of layout.annotations) {
      const anchor = a.spec.at ? layout.byId[a.spec.at] : undefined;
      out.push(`  - ${a.lines.join(' ')}${anchor ? ` (about ${name(anchor)})` : ''}`);
    }
    out.push('');
  }

  if (layout.legend) {
    out.push(`Legend: ${layout.legend.entries.map((l) => `${l.kind ?? 'base'} = ${l.label}`).join('; ')}`);
    out.push('');
  }

  if (spec.questions?.length) {
    out.push('Questions awaiting an answer:');
    for (const q of spec.questions) out.push(`  - ${q.text}`);
    out.push('');
  }

  if (layout.warnings.length) {
    out.push('Problems with this board:');
    for (const w of layout.warnings) out.push(`  - ${w.message}`);
  }

  return out.join('\n').trimEnd();
}

/** Short label used when referring to an element from elsewhere. */
export function name(e: PlacedElement | undefined): string {
  if (!e) return 'something';
  if (e.type === 'node') return e.lines.join(' ') || e.id;
  if (e.type === 'table') return e.spec.title ? `table "${e.spec.title}"` : `table ${e.id}`;
  return e.spec.breadcrumb ? `form "${e.spec.breadcrumb}"` : `form ${e.id}`;
}

/** Accessible name for one focusable element. */
export function ariaLabel(e: PlacedElement, layout: LayoutResult): string {
  const outgoing = layout.edges.filter((x) => x.from === e.id).length;
  const incoming = layout.edges.filter((x) => x.to === e.id).length;
  const rel: string[] = [];
  if (incoming) rel.push(`${incoming} incoming`);
  if (outgoing) rel.push(`${outgoing} outgoing`);
  const frame = e.frameId ? layout.frames.find((f) => f.id === e.frameId) : undefined;
  return [
    describeElement(e).split('\n')[0],
    frame ? `in ${frame.title || frame.id}` : '',
    rel.length ? rel.join(', ') : ''
  ]
    .filter(Boolean)
    .join(', ');
}

function indent(s: string, prefix: string): string {
  const [first, ...rest] = s.split('\n');
  return [prefix + first, ...rest.map((l) => '    ' + l.trim())].join('\n');
}
