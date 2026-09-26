/**
 * The board contract, shared by the extension host and the webview.
 *
 * Source of truth: specs/001-production-extension/data-model.md and
 * schemas/board.schema.json. Where the renderer and SKILL.md disagreed, the
 * disagreement is recorded here as a comment rather than silently resolved —
 * FR-020 requires the two to be reconciled and kept in sync by a test.
 */

export const SCHEMA_VERSION = 1;

/** Semantic classification, not state. Seven values = the rows of the 7x4 contrast matrix (SC-002). */
export type Kind = 'base' | 'problem' | 'fix' | 'data' | 'accent' | 'note' | 'muted';

export const KINDS: readonly Kind[] = ['base', 'problem', 'fix', 'data', 'accent', 'note', 'muted'];

export type Shape = 'rect' | 'round' | 'pill' | 'note' | 'ellipse' | 'diamond' | 'cyl';

export const SHAPES: readonly Shape[] = ['rect', 'round', 'pill', 'note', 'ellipse', 'diamond', 'cyl'];

/**
 * THE source of truth for render styles.
 *
 * This list used to exist four times over — the type union, the host
 * validator, the published JSON schema and SKILL.md — and adding `drawio`
 * to three of them meant a board asking for it was rejected as invalid
 * before it ever reached the renderer. The union is derived from this array
 * so the validator cannot drift from the type again.
 */
export const RENDER_STYLES = ['sketchy', 'clean', 'mermaid', 'drawio'] as const;

export type RenderStyle = (typeof RENDER_STYLES)[number];

export type ThemeKind = 'dark' | 'light' | 'high-contrast-dark' | 'high-contrast-light';

/** Where an annotation sits relative to its anchor. THE mechanism; dx/dy only fine-tune it. */
export type Place = 'below' | 'above' | 'left' | 'right';

export type EdgeStyle = 'solid' | 'dashed' | 'dotted';

export type Align = 'left' | 'right';

export interface Frame {
  id: string;
  title?: string;
  /** Element ids in draw order. Wins over an element's own `frame` for ordering. */
  items?: string[];
  /** Alias for `items`. */
  nodes?: string[];
  flow?: 'col' | 'row';
  /**
   * MODE SWITCH: if ANY frame declares `row` or `col`, the whole board uses an
   * explicit grid instead of flowing bands.
   */
  row?: number;
  col?: number;
  nodeWidth?: number;
  /** Undocumented in SKILL.md; read by the renderer. */
  align?: string;
  color?: string;
  titleColor?: string;
}

export interface BoardNode {
  /** Also seeds the hand-drawn wobble, so it must be stable across incremental rewrites. */
  id: string;
  label?: string;
  /** Dimmed second line. By convention the concrete evidence: a record id, a value. */
  sub?: string;
  kind?: Kind;
  shape?: Shape;
  emphasis?: boolean;
  badge?: string;
  hatch?: boolean;
  frame?: string;
  color?: string;
  fill?: string;
  textColor?: string;
  /** @deprecated legacy hand-placed geometry */
  x?: number;
  /** @deprecated */
  y?: number;
  /** @deprecated AUTHORITATIVE when present — asymmetric with `h`, which is only a minimum. */
  w?: number;
  /** @deprecated a MINIMUM only */
  h?: number;
}

export interface Edge {
  /**
   * Optional and new. Without it the wobble seed derives from from/to/label
   * rather than the array index, so inserting an edge no longer reshuffles
   * every later edge's stroke.
   */
  id?: string;
  from?: string;
  to?: string;
  /** @deprecated undocumented alias for `from` */
  source?: string;
  /** @deprecated undocumented alias for `to` */
  target?: string;
  label?: string;
  style?: EdgeStyle;
  kind?: Kind;
  emphasis?: boolean;
  /** Only an actual `false` suppresses the head. */
  arrow?: boolean;
  color?: string;
}

export interface Annotation {
  text: string;
  at?: string;
  atFrame?: string;
  place?: Place;
  dx?: number;
  dy?: number;
  x?: number;
  y?: number;
  anchor?: 'start' | 'middle' | 'end';
  size?: number;
  width?: number;
  rotate?: number;
  underline?: boolean;
  /** Undocumented in SKILL.md. */
  opacity?: number;
  kind?: Kind;
  color?: string;
  arrowTo?: string;
}

export interface CellObject {
  text?: string | number | null;
  kind?: Kind;
  bold?: boolean;
  dim?: boolean;
}

export type Cell = string | number | null | CellObject;

export type Row = Cell[] | { kind?: Kind; cells: Cell[] };

export interface Column {
  label?: string;
  /** Convention: quantities are always 'right'. */
  align?: Align;
  /** Undocumented in SKILL.md. */
  width?: number;
}

export interface Table {
  id: string;
  title?: string;
  kind?: Kind;
  frame?: string;
  columns?: (string | Column)[];
  rows?: Row[];
  /** Undocumented in SKILL.md. */
  w?: number;
  /** Undocumented in SKILL.md. */
  color?: string;
}

export interface ScreenField {
  label?: string;
  value?: string | number | null;
  kind?: Kind;
  emphasis?: boolean;
}

export interface ScreenGroup {
  title?: string;
  columns?: number;
  fields?: ScreenField[];
}

export interface ScreenButton {
  label?: string;
  kind?: Kind;
  /** Fills the chip. */
  primary?: boolean;
}

export interface ScreenStatus {
  label?: string;
  kind?: Kind;
  active?: boolean;
}

export interface Screen {
  id: string;
  kind?: Kind;
  frame?: string;
  color?: string;
  /**
   * A MINIMUM. KNOWN DRIFT: SKILL.md says it "grows to fit", but the current
   * renderer grows the inner width only for an embedded `table`, never for
   * wide `groups` fields. Reconciled by T145.
   */
  width?: number;
  breadcrumb?: string;
  buttons?: (string | ScreenButton)[];
  statusbar?: (string | ScreenStatus)[];
  groups?: ScreenGroup[];
  table?: Table;
  footer?: string;
}

export interface LegendEntry {
  kind?: Kind;
  label: string;
}

export interface Question {
  /**
   * MUST be stable across rewrites of the same board. The only field in the
   * schema with a cross-write stability requirement: it is what lets the panel
   * tell "already answered" from "still pending", and what an Answer's
   * questionId refers to.
   */
  id: string;
  text: string;
}

export interface BoardSpec {
  schemaVersion?: number;
  style?: RenderStyle;
  /**
   * BOARD IDENTITY. A changed title means "this is a different board" and
   * causes the outgoing board to be archived. Incremental rewrites of one
   * board MUST reuse the title.
   */
  title: string;
  layout?: 'columns' | 'rows';
  maxWidth?: number;
  nodeWidth?: number;
  /** Undocumented in SKILL.md. */
  align?: string;
  /** Required when style is 'mermaid'. */
  code?: string;
  frames?: Frame[];
  /** @deprecated undocumented alias for `frames` */
  groups?: Frame[];
  nodes?: BoardNode[];
  tables?: Table[];
  screens?: Screen[];
  edges?: Edge[];
  annotations?: Annotation[];
  /** @deprecated undocumented alias for `annotations` */
  notes?: Annotation[];
  legend?: LegendEntry[];
  questions?: Question[];
  /** Forward compatibility: unknown fields are ignored, never rejected (FR-012). */
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Validation results                                                  */
/* ------------------------------------------------------------------ */

export interface ValidationIssue {
  /** JSON Pointer to the offending field. */
  path: string;
  message: string;
}

export type WarningCode =
  | 'dangling-edge'
  | 'missing-frame'
  | 'unknown-kind'
  | 'unknown-shape'
  | 'duplicate-id'
  | 'schema';

export interface Warning {
  code: WarningCode;
  /** JSON Pointer, or an element id where a pointer is not meaningful. */
  path: string;
  message: string;
}

export interface ValidationResult {
  fatal: ValidationIssue[];
  warnings: Warning[];
}

/* ------------------------------------------------------------------ */
/* Feedback log                                                        */
/* ------------------------------------------------------------------ */

export interface FeedbackEntryBase {
  id: string;
  /** ISO 8601. */
  at: string;
  /** Set once handed to the agent, so the same answer is never applied twice. */
  consumed?: boolean;
  /** The board that was live when the mark was made. */
  boardTitle?: string;
}

export interface Answer extends FeedbackEntryBase {
  questionId: string;
  /** Copied at answer time so the entry stays self-contained after the board is replaced. */
  question?: string;
  text: string;
}

export interface Drawing extends FeedbackEntryBase {
  color?: string;
  /**
   * Board-pixel coordinates from the layout that was live when the mark was
   * made. A re-layout shifts everything, so these mean "roughly here".
   * Decimated before storage (FR-040).
   */
  points: [number, number][];
}

export interface Sticky extends FeedbackEntryBase {
  x: number;
  y: number;
  text: string;
}

/**
 * The user moved something Claude drew.
 *
 * Kept in the same durable channel as the other marks, which means the board
 * stays Claude's document (positions still come from layout) while the user's
 * rearrangement survives a rewrite — and Claude can see that a node was moved,
 * which is itself useful feedback.
 *
 * Upserted by (boardTitle, targetId): moving the same node twice replaces the
 * offset rather than stacking another entry.
 */
export interface Move extends FeedbackEntryBase {
  /** The element id from the board spec, or a mark id. */
  targetId: string;
  dx: number;
  dy: number;
}

export interface FeedbackLog {
  schemaVersion?: number;
  answers: Answer[];
  drawings: Drawing[];
  stickies: Sticky[];
  /** Optional for forward/backward compatibility with older logs. */
  moves?: Move[];
}

export const EMPTY_FEEDBACK: FeedbackLog = {
  schemaVersion: SCHEMA_VERSION,
  answers: [],
  drawings: [],
  stickies: [],
  moves: []
};

/** Offsets to apply after layout, keyed by element id. */
export type MoveMap = Record<string, { dx: number; dy: number }>;

/* ------------------------------------------------------------------ */
/* Library                                                             */
/* ------------------------------------------------------------------ */

export interface LibraryEntry {
  file: string;
  title: string;
  /** ISO 8601, from file mtime. */
  savedAt: string;
}
