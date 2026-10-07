/**
 * The extension-host <-> webview contract, imported by BOTH bundles so the
 * message union is checked at compile time in both directions.
 *
 * Previously the two sides agreed only by convention, which is how the
 * "viewing a saved board" flag came to exist in two copies that could diverge.
 */

import type {
  BoardSpec,
  FeedbackLog,
  LibraryEntry,
  RenderStyle,
  ThemeKind,
  ValidationIssue,
  Warning
} from './types.js';

/* ------------------------------------------------------------------ */
/* LibraryFileName — the security-critical type                        */
/* ------------------------------------------------------------------ */

/**
 * A validated library filename. This is the ONE place a string crosses from
 * the webview into a filesystem path, and it was previously unchecked:
 * `resumeLive` did `fs.copyFileSync(path.join(dir, msg.file), notesPath)`, so
 * a crafted value copied an arbitrary readable file into the workspace.
 *
 * Branded so a raw string cannot be passed where one of these is expected.
 */
export type LibraryFileName = string & { readonly __libraryFileName: unique symbol };

const LIBRARY_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

/**
 * Syntactic half of the check (FR-034). The host MUST additionally resolve the
 * path and assert it is a direct child of the library directory, because this
 * cannot see symlinks.
 */
export function isLibraryFileName(v: unknown): v is LibraryFileName {
  if (typeof v !== 'string') return false;
  if (v.length < 1 || v.length > 128) return false;
  if (v === '.' || v === '..') return false;
  if (v.includes('/') || v.includes('\\') || v.includes('\0')) return false;
  // A leading dot is excluded by the pattern's first character class, which
  // also rejects "..json" and any dotfile.
  return LIBRARY_FILE_RE.test(v);
}

/* ------------------------------------------------------------------ */
/* Host -> Webview                                                     */
/* ------------------------------------------------------------------ */

export interface RenderMessage {
  type: 'render';
  spec: BoardSpec;
  /**
   * Monotonic. The webview drops any render whose generation is lower than the
   * highest it has started — renderSpec awaits mermaid, so two renders close
   * together could otherwise interleave and the earlier overwrite the later.
   */
  generation: number;
  /** Set when showing a saved board rather than the live one. */
  viewingSaved?: string;
  /** Recoverable problems: the board still draws (FR-011). */
  warnings?: Warning[];
  /** Named only in a multi-root workspace, so the user knows which folder is watched. */
  watchedFolder?: string;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
  /** Field-level detail, so the panel can name the offending path (FR-008). */
  detail?: ValidationIssue[];
}

export interface ClearMessage {
  type: 'clear';
}

export interface FeedbackStateMessage {
  type: 'feedbackState';
  data: FeedbackLog;
}

export interface LibraryMessage {
  type: 'library';
  items: LibraryEntry[];
}

export interface LiveUpdatedMessage {
  type: 'liveUpdated';
}

export interface ThemeChangedMessage {
  type: 'themeChanged';
  kind: ThemeKind;
  /**
   * agentBoard.reducedMotion = "always". VS Code's own preference already
   * arrives as a body class; this is the per-panel override, which the webview
   * cannot read for itself.
   */
  forceReducedMotion?: boolean;
}

export interface SetStyleMessage {
  type: 'setStyle';
  style: RenderStyle;
}

/** Viewport commands driven from the palette rather than the panel toolbar. */
export interface ViewportMessage {
  type: 'viewport';
  action: 'fit' | 'resetZoom' | 'copyDescription';
}

export type HostToWebview =
  | RenderMessage
  | ErrorMessage
  | ClearMessage
  | FeedbackStateMessage
  | LibraryMessage
  | LiveUpdatedMessage
  | ThemeChangedMessage
  | SetStyleMessage
  | ViewportMessage;

/* ------------------------------------------------------------------ */
/* Webview -> Host                                                     */
/* ------------------------------------------------------------------ */

export interface ReadyMessage {
  type: 'ready';
}

export type FeedbackKind = 'answer' | 'drawing' | 'sticky';

export interface AnswerPayload {
  questionId: string;
  question?: string;
  text: string;
}

export interface DrawingPayload {
  color?: string;
  /** Decimated before posting (FR-040). */
  points: [number, number][];
}

export interface StickyPayload {
  x: number;
  y: number;
  text: string;
}

export type FeedbackMessage =
  | { type: 'feedback'; kind: 'answer'; payload: AnswerPayload }
  | { type: 'feedback'; kind: 'drawing'; payload: DrawingPayload }
  | { type: 'feedback'; kind: 'sticky'; payload: StickyPayload };

export interface ClearFeedbackMessage {
  type: 'clearFeedback';
}

/**
 * Edit a mark in place rather than appending another one.
 *
 * Without this a sticky could only ever be created: re-editing it appended a
 * second entry, and moving it was impossible because position was fixed at
 * creation.
 */
export interface UpdateMarkMessage {
  type: 'updateMark';
  id: string;
  patch: { x?: number; y?: number; text?: string; dx?: number; dy?: number };
}

export interface DeleteMarkMessage {
  type: 'deleteMark';
  id: string;
}

/**
 * The user dragged something Claude drew. Upserted per board + target, so the
 * offset is replaced rather than accumulated into a pile of entries.
 */
export interface MoveElementMessage {
  type: 'moveElement';
  targetId: string;
  dx: number;
  dy: number;
}

export interface ListLibraryMessage {
  type: 'listLibrary';
}

export interface SaveBoardMessage {
  type: 'saveBoard';
}

export interface LoadFromLibraryMessage {
  type: 'loadFromLibrary';
  file: string;
}

export interface ResumeLiveMessage {
  type: 'resumeLive';
  file: string;
}

export interface BackToLiveMessage {
  type: 'backToLive';
}

export interface CopyMentionMessage {
  type: 'copyMention';
  file: string;
  title?: string;
}

export interface StyleChangedMessage {
  type: 'styleChanged';
  style: RenderStyle;
}

export interface AnnounceMessage {
  type: 'announce';
  text: string;
  assertive?: boolean;
}

/** The webview handing back the board's text alternative for the clipboard. */
export interface DescriptionMessage {
  type: 'description';
  text: string;
}

export type WebviewToHost =
  | ReadyMessage
  | FeedbackMessage
  | ClearFeedbackMessage
  | UpdateMarkMessage
  | DeleteMarkMessage
  | MoveElementMessage
  | ListLibraryMessage
  | SaveBoardMessage
  | LoadFromLibraryMessage
  | ResumeLiveMessage
  | BackToLiveMessage
  | CopyMentionMessage
  | StyleChangedMessage
  | AnnounceMessage
  | DescriptionMessage;

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

/**
 * Both receivers must tolerate a null/non-object message and an unknown
 * `type`. The old webview dereferenced `msg.type` unguarded, and neither side
 * had a default branch.
 */
export function isMessage(v: unknown): v is { type: string } {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';
}
