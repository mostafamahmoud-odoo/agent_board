import type { BoardSpec, Edge, Frame } from '../../shared/types.js';

/**
 * Turns a structural board into mermaid source.
 *
 * WHY THIS EXISTS: the style menu offered "Mermaid" for every board, but
 * mermaid renders a `code` string — it is a different input format, not a
 * restyle of the same content. Picking it on a board made of nodes and frames
 * produced "this board has style mermaid but no code", which is a dead end
 * dressed up as an option.
 *
 * Deriving the source makes the choice mean something: the same board, drawn
 * by mermaid's layout engine instead of ours. A board that already carries
 * `code` still uses it verbatim.
 */

/** Mermaid ids must be simple; keep a stable, collision-free mapping. */
function safeId(raw: string, used: Map<string, string>): string {
  const existing = used.get(raw);
  if (existing) return existing;
  let base = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '') || 'n';
  if (/^\d/.test(base)) base = 'n' + base;
  let id = base;
  let i = 2;
  const taken = new Set(used.values());
  while (taken.has(id)) id = `${base}_${i++}`;
  used.set(raw, id);
  return id;
}

/**
 * Mermaid label text is delimited by quotes; `"` ends it early and `\n` breaks
 * the statement. `<br/>` is mermaid's own line break and survives the strict
 * security level.
 */
function label(text: unknown, max = 70): string {
  const s = String(text ?? '')
    .replace(/"/g, "'")
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('<br/>');
  if (s.length <= max) return s || ' ';
  return s.slice(0, max - 1) + '…';
}

/** Mermaid's bracket pairs, chosen to echo the board's own shapes. */
function wrapShape(shape: string | undefined, id: string, text: string): string {
  switch (shape) {
    case 'round':
      return `${id}("${text}")`;
    case 'pill':
      return `${id}(["${text}"])`;
    case 'ellipse':
      return `${id}(("${text}"))`;
    case 'diamond':
      return `${id}{"${text}"}`;
    case 'cyl':
      return `${id}[("${text}")]`;
    case 'note':
      return `${id}>"${text}"]`;
    default:
      return `${id}["${text}"]`;
  }
}

function arrow(e: Edge): string {
  const style = e.style;
  if (e.arrow === false) return style === 'dotted' ? '-.-' : style === 'dashed' ? '---' : '---';
  if (style === 'dotted') return '-.->';
  if (style === 'dashed') return '-->';
  return e.emphasis ? '==>' : '-->';
}

export interface DerivedMermaid {
  code: string;
  /** Things the board can express and mermaid cannot. */
  warnings: string[];
}

export function boardToMermaid(spec: BoardSpec): DerivedMermaid {
  const warnings: string[] = [];
  const used = new Map<string, string>();
  const lines: string[] = ['flowchart TB'];

  const nodes = spec.nodes ?? [];
  const tables = spec.tables ?? [];
  const screens = spec.screens ?? [];
  const frames = (spec.frames ?? spec.groups ?? []) as Frame[];

  // Everything the board can draw, reduced to a mermaid node.
  const declared = new Map<string, string>();
  const declare = (id: string, text: string, shape?: string) => {
    const mid = safeId(id, used);
    declared.set(id, wrapShape(shape, mid, label(text)));
    return mid;
  };

  for (const n of nodes) {
    if (!n?.id) continue;
    const text = n.sub ? `${n.label ?? n.id}<br/><small>${n.sub}</small>` : (n.label ?? n.id);
    declare(n.id, text, n.shape);
  }
  for (const t of tables) {
    if (!t?.id) continue;
    declare(t.id, t.title ? `${t.title} (table)` : 'table', 'cyl');
  }
  for (const s of screens) {
    if (!s?.id) continue;
    declare(s.id, s.breadcrumb ? `${s.breadcrumb} (form)` : 'form', 'round');
  }
  if (tables.length || screens.length) {
    warnings.push('Tables and forms become single boxes in mermaid — their rows and fields are not shown.');
  }

  // Frames become subgraphs; anything ungrouped is emitted at the top level.
  const grouped = new Set<string>();
  for (const f of frames) {
    const ids = (f.items ?? f.nodes ?? []).filter((id) => declared.has(id));
    for (const el of [...nodes, ...tables, ...screens]) {
      const fid = (el as { frame?: string; id?: string }).frame;
      if (fid === f.id && el.id && declared.has(el.id) && !ids.includes(el.id)) ids.push(el.id);
    }
    if (!ids.length) continue;
    lines.push(`  subgraph ${safeId('sg_' + f.id, used)}["${label(f.title ?? f.id)}"]`);
    for (const id of ids) {
      lines.push(`    ${declared.get(id)}`);
      grouped.add(id);
    }
    lines.push('  end');
  }
  for (const [id, decl] of declared) {
    if (!grouped.has(id)) lines.push(`  ${decl}`);
  }

  for (const e of (spec.edges ?? []) as Edge[]) {
    const from = e.from ?? e.source;
    const to = e.to ?? e.target;
    if (!from || !to || !declared.has(from) || !declared.has(to)) continue;
    const a = safeId(from, used);
    const b = safeId(to, used);
    const text = e.label ? `|"${label(e.label, 40)}"|` : '';
    lines.push(`  ${a} ${arrow(e)}${text} ${b}`);
  }

  if (spec.annotations?.length || spec.notes?.length) {
    warnings.push('Margin notes are left out — mermaid has no equivalent.');
  }
  if (declared.size === 0) {
    return { code: 'flowchart TB\n  empty["(nothing on this board yet)"]', warnings };
  }

  return { code: lines.join('\n'), warnings };
}

/** True when a board can be shown as mermaid at all. */
export function canRenderAsMermaid(spec: BoardSpec | null): boolean {
  if (!spec) return false;
  if (typeof spec.code === 'string' && spec.code.trim()) return true;
  return Boolean(spec.nodes?.length || spec.tables?.length || spec.screens?.length);
}
