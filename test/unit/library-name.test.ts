import { describe, expect, it } from 'vitest';
import { slugify } from '../../src/extension/library.js';

describe('library filenames are title-derived and stable (FR-039)', () => {
  it('derives a slug from the title', () => {
    expect(slugify('Migration plan')).toBe('migration-plan.json');
  });

  it('is STABLE for the same title, so an auto-save overwrites', () => {
    // The prototype appended an ISO timestamp, so a session that retitled
    // repeatedly left one file per change and the library grew forever.
    expect(slugify('Same board')).toBe(slugify('Same board'));
  });

  it('strips punctuation and collapses separators', () => {
    expect(slugify('Why PM 122 grew to 5 rows!!')).toBe('why-pm-122-grew-to-5-rows.json');
  });

  it('caps the length', () => {
    expect(slugify('x'.repeat(200)).length).toBeLessThanOrEqual(65);
  });

  it('falls back for an empty or junk title', () => {
    expect(slugify('')).toBe('note.json');
    expect(slugify('!!!')).toBe('note.json');
    expect(slugify(undefined)).toBe('note.json');
  });

  it('always produces a name the LibraryFileName validator accepts', () => {
    for (const t of ['Migration plan', '!!!', 'x'.repeat(200), '2026 review', 'a/b\\c']) {
      expect(slugify(t)).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/);
    }
  });
});
