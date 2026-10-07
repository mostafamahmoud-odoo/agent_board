import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import type { BoardSpec, LibraryEntry } from '../shared/types.js';
import { isLibraryFileName } from '../shared/protocol.js';
import { writeJsonAtomic } from './fsAtomic.js';
import { isWritable, libraryDir } from './workspace.js';

/**
 * The per-project board library at `.agent/notes/<slug>.json`.
 *
 * Two defects this module fixes:
 *
 * 1. PATH TRAVERSAL (FR-034). The prototype did `path.join(dir, msg.file)`
 *    with an unvalidated webview string, and `resumeLive` then
 *    `fs.copyFileSync(full, notesPath)` — copying an arbitrary readable file
 *    into the workspace. `resolveInLibrary` is now the only way in.
 * 2. UNBOUNDED GROWTH (FR-039). `slugify` appended a timestamp, so an
 *    auto-save never overwrote: one file per title change. And every listing
 *    fully read and parsed every file. Now the slug is title-derived and the
 *    listing is an mtime-keyed cache.
 */

export function slugify(title: unknown): string {
  const base =
    String(title || 'note')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'note';
  return `${base}.json`;
}

/**
 * Resolves a webview-supplied filename inside the library, or returns
 * undefined. Checks the syntax, then resolves symlinks and asserts the real
 * path is a direct child of the library directory.
 */
export function resolveInLibrary(file: unknown): string | undefined {
  if (!isLibraryFileName(file)) return undefined;
  const dir = libraryDir();
  if (!dir) return undefined;

  const candidate = path.resolve(dir, file);
  const realDir = safeRealpath(dir);
  const realCandidate = safeRealpath(candidate);
  if (!realDir) return undefined;

  // The file may not exist yet (a save); check the parent in that case.
  const parent = path.dirname(realCandidate ?? candidate);
  const realParent = safeRealpath(parent) ?? parent;
  if (realParent !== realDir) return undefined;
  if (path.dirname(candidate) !== path.resolve(dir)) return undefined;
  return candidate;
}

function safeRealpath(p: string): string | undefined {
  try {
    return fs.realpathSync(p);
  } catch {
    return undefined;
  }
}

/* --------------------------------------------------------- listing cache */

interface CacheEntry {
  mtimeMs: number;
  title: string;
}
const titleCache = new Map<string, CacheEntry>();

/**
 * Lists the library without re-parsing every file on every call. Only files
 * whose mtime changed are re-read.
 */
export function listLibrary(): LibraryEntry[] {
  const dir = libraryDir();
  if (!dir) return [];
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }

  const out: LibraryEntry[] = [];
  const seen = new Set<string>();
  for (const f of names) {
    const full = path.join(dir, f);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    seen.add(f);
    const cached = titleCache.get(f);
    let title: string;
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      title = cached.title;
    } else {
      title = f.replace(/\.json$/, '');
      try {
        const spec = JSON.parse(fs.readFileSync(full, 'utf8')) as BoardSpec;
        if (spec && typeof spec.title === 'string' && spec.title) title = spec.title;
      } catch {
        /* keep the filename as the title */
      }
      titleCache.set(f, { mtimeMs: stat.mtimeMs, title });
    }
    out.push({ file: f, title, savedAt: stat.mtime.toISOString() });
  }
  for (const k of [...titleCache.keys()]) if (!seen.has(k)) titleCache.delete(k);

  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

function maxEntries(): number {
  return Math.max(10, vscode.workspace.getConfiguration('agentBoard').get<number>('library.maxEntries', 200));
}

function enforceBound(): void {
  const dir = libraryDir();
  if (!dir) return;
  const entries = listLibrary();
  const over = entries.length - maxEntries();
  if (over <= 0) return;
  // Oldest first.
  const doomed = entries.slice().sort((a, b) => a.savedAt.localeCompare(b.savedAt)).slice(0, over);
  for (const e of doomed) {
    try {
      fs.unlinkSync(path.join(dir, e.file));
      titleCache.delete(e.file);
    } catch {
      /* best effort */
    }
  }
}

/**
 * Saves a board under a title-derived name, OVERWRITING the previous save of
 * the same board. The prototype appended an ISO timestamp so every auto-save
 * created a new file.
 */
export function saveSpec(spec: BoardSpec): string | undefined {
  if (!isWritable()) return undefined;
  const dir = libraryDir();
  if (!dir || !spec || typeof spec.title !== 'string') return undefined;
  const name = slugify(spec.title);
  const full = resolveInLibrary(name);
  if (!full) return undefined;
  try {
    writeJsonAtomic(full, spec);
    titleCache.delete(name);
    enforceBound();
    return name;
  } catch {
    return undefined;
  }
}

export function loadSpec(file: unknown): BoardSpec | undefined {
  const full = resolveInLibrary(file);
  if (!full || !fs.existsSync(full)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8')) as BoardSpec;
  } catch {
    return undefined;
  }
}

export function readRaw(file: unknown): string | undefined {
  const full = resolveInLibrary(file);
  if (!full || !fs.existsSync(full)) return undefined;
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return undefined;
  }
}
