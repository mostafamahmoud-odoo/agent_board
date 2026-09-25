import { describe, expect, it } from 'vitest';
import type { FeedbackLog } from '../../src/shared/types.js';
import { prune } from '../../src/extension/feedback.js';

const at = (n: number) => new Date(2026, 0, 1, 0, 0, n).toISOString();

function log(opts: { answers?: number; drawings?: number; stickies?: number; consumed?: boolean }): FeedbackLog {
  const c = opts.consumed ?? false;
  return {
    schemaVersion: 1,
    answers: Array.from({ length: opts.answers ?? 0 }, (_, i) => ({
      id: `a-${i}`, at: at(i), consumed: c, questionId: `q${i}`, text: `answer ${i}`
    })),
    drawings: Array.from({ length: opts.drawings ?? 0 }, (_, i) => ({
      id: `d-${i}`, at: at(i), consumed: c, points: [[0, 0], [1, 1]] as [number, number][]
    })),
    stickies: Array.from({ length: opts.stickies ?? 0 }, (_, i) => ({
      id: `s-${i}`, at: at(i), consumed: c, x: 0, y: 0, text: `note ${i}`
    }))
  };
}

const total = (l: FeedbackLog) => l.answers.length + l.drawings.length + l.stickies.length;

describe('feedback log stays bounded (FR-014, SC-008)', () => {
  it('does nothing when under the cap', () => {
    const l = log({ answers: 3, drawings: 3 });
    expect(total(prune(l, 100))).toBe(6);
  });

  it('brings an over-full log down to the cap', () => {
    const l = log({ drawings: 200, consumed: true });
    expect(total(prune(l, 50))).toBeLessThanOrEqual(50);
  });

  it('NEVER drops a pending answer to make room', () => {
    // The whole point: losing the user's words to a size limit would be worse
    // than the unbounded file this replaces.
    const l = log({ answers: 30 });          // all pending
    l.drawings = log({ drawings: 200, consumed: true }).drawings;
    prune(l, 40);
    expect(l.answers).toHaveLength(30);
    expect(total(l)).toBeLessThanOrEqual(40);
  });

  it('prunes consumed entries before pending ones', () => {
    const l = log({ drawings: 60, consumed: true });
    l.stickies = log({ stickies: 30 }).stickies; // pending
    prune(l, 40);
    expect(l.stickies).toHaveLength(30);
    expect(l.drawings.length).toBeLessThanOrEqual(10);
  });

  it('prunes oldest first', () => {
    const l = log({ drawings: 20, consumed: true });
    prune(l, 5);
    const kept = l.drawings.map((d) => d.at).sort();
    // whatever survived must be from the newest end
    expect(kept[0] >= at(10)).toBe(true);
  });
});
