import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Write-to-temp-then-rename (FR-010).
 *
 * Every write to `.claude/` goes through here. Plain writeFileSync let a
 * reader observe a half-written file, which is how the feedback log got
 * corrupted in the first place — and a corrupt feedback log used to be
 * silently replaced with an empty one, destroying every captured answer.
 *
 * rename(2) is atomic within a filesystem, which is what the temp file being
 * a sibling guarantees.
 */
export function writeFileAtomic(target: string, contents: string): void {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, contents, 'utf8');
    fs.renameSync(tmp, target);
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* the rename already failed; nothing further to do about the temp file */
    }
    throw e;
  }
}

export function writeJsonAtomic(target: string, value: unknown): void {
  writeFileAtomic(target, JSON.stringify(value, null, 2));
}

/**
 * Read a file only once it has stopped changing.
 *
 * The prototype used a flat `setTimeout(..., 50)` after a watcher event, so a
 * writer slower than 50 ms produced a partial read and a visible error. This
 * polls size+mtime until two consecutive samples agree.
 */
export async function readWhenSettled(
  file: string,
  opts: { intervalMs?: number; maxWaitMs?: number } = {}
): Promise<string | undefined> {
  const interval = opts.intervalMs ?? 30;
  const maxWait = opts.maxWaitMs ?? 1500;
  const deadline = Date.now() + maxWait;
  let last = '';
  let lastStat = '';

  for (;;) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return undefined;
    }
    const sig = `${stat.size}:${stat.mtimeMs}`;
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
    if (sig === lastStat && text === last) return text;
    lastStat = sig;
    last = text;
    if (Date.now() > deadline) return text;
    await new Promise((r) => setTimeout(r, interval));
  }
}
