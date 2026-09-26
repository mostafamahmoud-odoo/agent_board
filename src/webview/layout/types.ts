/**
 * The artifact the layout stage produces. Every renderer (sketchy, clean,
 * mermaid) and the accessibility describer consume this and nothing else, so
 * geometry is computed exactly once.
 *
 * Nothing here is written back onto the BoardSpec — the old renderer mutated
 * `_x/_y/_w/_h/_lines/_cols/_rows/_groups/_ids` onto the caller's object and
 * used the spec as a shared bus between measure, layout and draw.
 */

import type {
  Annotation,
  BoardNode,
  Column,
  Edge,
  Frame,
  Kind,
  LegendEntry,
  Row,
  Screen,
  ScreenGroup,
  Shape,
  Table,
  Warning
} from '../../shared/types.js';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type ElementType = 'node' | 'table' | 'screen';

export interface PlacedBase extends Box {
  id: string;
  type: ElementType;
  /** The frame this element was placed in, if any. */
  frameId?: string;
}

export interface PlacedNode extends PlacedBase {
  type: 'node';
  spec: BoardNode;
  kind: Kind;
  shape: Shape;
  /** Wrapped once, here. */
  lines: string[];
  subLines: string[];
}

export interface MeasuredColumn extends Column {
  /** Computed content width. */
  w: number;
}

export interface MeasuredRow {
  kind: Kind | null;
  cells: Row extends unknown ? unknown[] : never;
}

export interface PlacedTable extends PlacedBase {
  type: 'table';
  spec: Table;
  kind: Kind;
  columns: MeasuredColumn[];
  rows: { kind: Kind | null; cells: unknown[] }[];
  /** Height of the optional caption row. */
  capH: number;
  /** Summed column width. */
  tw: number;
}

export interface MeasuredGroup {
  def: ScreenGroup;
  cols: number;
  /** Field width within the group. */
  fw: number;
  h: number;
}

export interface PlacedScreen extends PlacedBase {
  type: 'screen';
  spec: Screen;
  kind: Kind;
  groups: MeasuredGroup[];
  table: Omit<PlacedTable, keyof PlacedBase | 'spec' | 'type'> & { spec: Table; w: number; h: number } | null;
  inner: number;
}

export type PlacedElement = PlacedNode | PlacedTable | PlacedScreen;

export interface PlacedFrame extends Box {
  id: string;
  spec: Frame;
  title?: string;
  /** Element ids inside, in draw order. */
  ids: string[];
  flowRow: boolean;
}

export interface RoutedEdge {
  spec: Edge;
  from: string;
  to: string;
  /** Stable seed derived from from/to/label, NOT the array index. */
  seed: number;
  kind?: Kind;
  /** Measured here, not guessed at draw time — and counted in bounds. */
  label?: { text: string; w: number; h: number };
}

/**
 * An annotation with its FINAL position already resolved — including the
 * owner-frame clamp. The old code computed this twice (drawAnnotation and the
 * bounds pass in drawSketchy) and the two copies had already diverged: the
 * bounds copy omitted the clamp entirely, so a clamped annotation could be
 * painted outside the computed viewBox.
 */
export interface PlacedAnnotation {
  spec: Annotation;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  lines: string[];
  size: number;
  /** Widest wrapped line, for bounds and underline. */
  textW: number;
  seed: number;
}

export interface PlacedLegend {
  entries: LegendEntry[];
  x: number;
  y: number;
  /** Measured width — contributes to bounds, unlike the old code which discarded it. */
  w: number;
  h: number;
}

export interface LayoutResult {
  bounds: Bounds;
  frames: PlacedFrame[];
  elements: PlacedElement[];
  byId: Record<string, PlacedElement>;
  edges: RoutedEdge[];
  annotations: PlacedAnnotation[];
  legend: PlacedLegend | null;
  warnings: Warning[];
  /** True when nothing at all was laid out, so renderers can show an empty state. */
  empty: boolean;
}
