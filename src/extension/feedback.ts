import * as fs from 'node:fs';
import * as vscode from 'vscode';

import type { Answer, Drawing, FeedbackLog, Sticky } from '../shared/types.js';
import { EMPTY_FEEDBACK, SCHEMA_VERSION } from '../shared/types.js';
import type { AnswerPayload, DrawingPayload, FeedbackKind, StickyPayload } from '../shared/protocol.js';
import { writeJsonAtomic } from './fsAtomic.js';
import { feedbackPath, isWritable } from './workspace.js';

/**
 * The one-way channel from the panel back to the agent.
 *
 * THE BUG THIS MODULE EXISTS TO FIX: the prototype caught a parse failure and
 * returned an empty object, and the next append wrote that empty object back
 * over the file — one partial write destroyed every accumulated answer, pen
 * stroke and sticky, silently. Here a read failure is *surfaced* and further
 * writes are refused until it is resolved (FR-035).
 */

export class FeedbackCorruptError extends Error {
  constructor(public readonly detail: string) {
    super(`The feedback log could not be read: ${detail}`);
  }
}

/** True once a read has failed; blocks writes so nothing is clobbered. */
let corrupt: string | null = null;

export function corruptReason(): string | null {
  return corrupt;
}

/** Clears the corrupt latch — only after the user has dealt with the file. */
export function clearCorruptLatch(): void {
  corrupt = null;
}

function empty(): FeedbackLog {
  return { schemaVersion: SCHEMA_VERSION, answers: [], drawings: [], stickies: [] };
}

/**
 * Reads the log. Throws FeedbackCorruptError rather than returning an empty
 * log, so no caller can mistake "unreadable" for "nothing there".
 */
export function readFeedback(): FeedbackLog {
  const p = feedbackPath();
  if (!p || !fs.existsSync(p)) return empty();
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8').trim();
  } catch (e) {
    corrupt = (e as Error).message;
    throw new FeedbackCorruptError(corrupt);
  }
  if (!raw) return empty();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    corrupt = (e as Error).message;
    throw new FeedbackCorruptError(corrupt);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    corrupt = 'the file does not contain a JSON object';
    throw new FeedbackCorruptError(corrupt);
  }
  const d = data as Partial<FeedbackLog>;
  return {
    schemaVersion: typeof d.schemaVersion === 'number' ? d.schemaVersion : 1,
    answers: Array.isArray(d.answers) ? d.answers : [],
    drawings: Array.isArray(d.drawings) ? d.drawings : [],
    stickies: Array.isArray(d.stickies) ? d.stickies : []
  };
}

/** Never throws; used where a best-effort view is enough (e.g. initial render). */
export function readFeedbackSafe(): FeedbackLog {
  try {
    return readFeedback();
  } catch {
    return Object.assign({}, EMPTY_FEEDBACK);
  }
}

function newId(kind: FeedbackKind): string {
  const initial = kind === 'answer' ? 'a' : kind === 'drawing' ? 'd' : 's';
  return `${initial}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface Bounds {
  maxEntries: number;
}

function limits(): Bounds {
  const cfg = vscode.workspace.getConfiguration('claudeNotes');
  return { maxEntries: Math.max(10, cfg.get<number>('feedback.maxEntries', 500)) };
}

/**
 * Consumed-first, oldest-first pruning (FR-014, SC-008).
 *
 * A pending answer is never dropped to make room — losing user input to a size
 * limit would be worse than the unbounded file this replaces.
 */
export function prune(log: FeedbackLog, maxEntries = limits().maxEntries): FeedbackLog {
  const total = () => log.answers.length + log.drawings.length + log.stickies.length;
  if (total() <= maxEntries) return log;

  type Bucket = 'answers' | 'drawings' | 'stickies';
  const buckets: Bucket[] = ['drawings', 'stickies', 'answers'];

  // Pass 1: consumed entries, oldest first.
  for (const pass of [true, false]) {
    for (const b of buckets) {
      const arr = log[b] as { at: string; consumed?: boolean }[];
      const removable = arr
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => (pass ? e.consumed === true : true))
        .sort((x, y) => String(x.e.at).localeCompare(String(y.e.at)));
      for (const { e } of removable) {
        if (total() <= maxEntries) return log;
        // Pass 2 still protects unconsumed answers: they are the user's words.
        if (!pass && b === 'answers' && !e.consumed) continue;
        const idx = arr.indexOf(e as never);
        if (idx >= 0) arr.splice(idx, 1);
      }
    }
  }
  return log;
}

export function appendFeedback(
  kind: FeedbackKind,
  payload: AnswerPayload | DrawingPayload | StickyPayload,
  boardTitle?: string
): FeedbackLog {
  if (!isWritable()) throw new Error('The workspace is not trusted, so feedback cannot be saved.');
  if (corrupt) throw new FeedbackCorruptError(corrupt);

  const p = feedbackPath();
  if (!p) throw new Error('No workspace folder is open.');

  const log = readFeedback();
  const base = { id: newId(kind), at: new Date().toISOString(), consumed: false, boardTitle };

  if (kind === 'answer') log.answers.push({ ...base, ...(payload as AnswerPayload) } as Answer);
  else if (kind === 'drawing') log.drawings.push({ ...base, ...(payload as DrawingPayload) } as Drawing);
  else log.stickies.push({ ...base, ...(payload as StickyPayload) } as Sticky);

  log.schemaVersion = SCHEMA_VERSION;
  prune(log);
  writeJsonAtomic(p, log);
  return log;
}

export function pendingCount(log = readFeedbackSafe()): number {
  return [...log.answers, ...log.drawings, ...log.stickies].filter((e) => !e.consumed).length;
}

export function markAllConsumed(): FeedbackLog {
  const p = feedbackPath();
  const log = readFeedback();
  if (!p) return log;
  for (const e of [...log.answers, ...log.drawings, ...log.stickies]) e.consumed = true;
  writeJsonAtomic(p, log);
  return log;
}

export function clearFeedback(): FeedbackLog {
  const p = feedbackPath();
  const fresh = empty();
  if (p) writeJsonAtomic(p, fresh);
  corrupt = null;
  return fresh;
}
