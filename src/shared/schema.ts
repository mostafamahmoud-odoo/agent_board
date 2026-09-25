/**
 * Board validation, in two tiers.
 *
 * WHY TWO: the published schema is the AUTHORING contract — editors should
 * flag every violation. But treating every violation as fatal would mean one
 * typo'd `kind` blanks an entire board, which is exactly the all-or-nothing
 * failure FR-011 rules out. So:
 *
 *   FATAL    the document is an object, `title` is a non-empty string,
 *            `style` is known, and `style: mermaid` carries `code`.
 *            -> posts `error`, nothing renders.
 *
 *   WARNING  everything else, including the kind/shape enums and the
 *            reference checks JSON Schema cannot express.
 *            -> posts a normal `render` with `warnings`; the valid part of
 *               the board still draws.
 *
 * Reference checks (dangling edges, missing frames, unknown enums) are
 * produced by the layout stage, which already has to resolve them.
 */

import type { BoardSpec, ValidationIssue, ValidationResult } from './types.js';

export { SCHEMA_VERSION } from './types.js';

const KNOWN_STYLES = ['sketchy', 'clean', 'mermaid'] as const;

/**
 * The fatal tier. Deliberately hand-written rather than schema-driven: it is
 * four rules, it must never itself throw, and it runs on every board write
 * including the incremental ones the skill encourages.
 */
export function validateFatal(raw: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      path: '',
      message: `A board must be a JSON object; got ${raw === null ? 'null' : Array.isArray(raw) ? 'an array' : typeof raw}.`
    });
    return issues;
  }

  const spec = raw as Record<string, unknown>;

  if (typeof spec.title !== 'string' || spec.title.trim() === '') {
    issues.push({
      path: '/title',
      message: 'A board needs a non-empty "title" — it is the board identity, and a changed title is what archives the previous board.'
    });
  }

  if (spec.style != null && !(KNOWN_STYLES as readonly unknown[]).includes(spec.style)) {
    issues.push({
      path: '/style',
      message: `Unknown style ${JSON.stringify(spec.style)}. Expected one of: ${KNOWN_STYLES.join(', ')}.`
    });
  }

  if (spec.style === 'mermaid' && (typeof spec.code !== 'string' || spec.code.trim() === '')) {
    issues.push({ path: '/code', message: 'style "mermaid" requires a non-empty "code" field.' });
  }

  for (const [key, expected] of [
    ['frames', 'array'],
    ['groups', 'array'],
    ['nodes', 'array'],
    ['tables', 'array'],
    ['screens', 'array'],
    ['edges', 'array'],
    ['annotations', 'array'],
    ['notes', 'array'],
    ['legend', 'array'],
    ['questions', 'array']
  ] as const) {
    if (spec[key] != null && !Array.isArray(spec[key])) {
      issues.push({ path: `/${key}`, message: `"${key}" must be an ${expected} if present.` });
    }
  }

  return issues;
}

/** Parse + fatal-validate in one step. Never throws. */
export function parseBoard(text: string): { spec?: BoardSpec; result: ValidationResult } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      result: {
        fatal: [{ path: '', message: `Not valid JSON: ${(e as Error).message}` }],
        warnings: []
      }
    };
  }
  const fatal = validateFatal(raw);
  if (fatal.length) return { result: { fatal, warnings: [] } };
  return { spec: raw as BoardSpec, result: { fatal: [], warnings: [] } };
}

/** Human-readable one-liner for the panel's error banner. */
export function describeIssues(issues: ValidationIssue[]): string {
  if (!issues.length) return '';
  return issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('\n');
}
