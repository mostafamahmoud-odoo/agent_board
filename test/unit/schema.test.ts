import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { isLibraryFileName } from '../../src/shared/protocol.js';
import { RENDER_STYLES } from '../../src/shared/types.js';
import { parseBoard, validateFatal } from '../../src/shared/schema.js';

describe('fatal tier: the document is unusable (FR-008)', () => {
  const fatal = (v: unknown) => validateFatal(v).map((i) => i.path);

  it('rejects null', () => expect(fatal(null)).toEqual(['']));
  it('rejects a bare string', () => expect(fatal('hello')).toEqual(['']));
  it('rejects a number', () => expect(fatal(123)).toEqual(['']));
  it('rejects an array', () => expect(fatal([])).toEqual(['']));
  it('rejects a missing title', () => expect(fatal({})).toContain('/title'));
  it('rejects an empty title', () => expect(fatal({ title: '   ' })).toContain('/title'));
  it('rejects an unknown style', () => expect(fatal({ title: 't', style: 'crayon' })).toContain('/style'));
  it('rejects mermaid without code', () => expect(fatal({ title: 't', style: 'mermaid' })).toContain('/code'));
  it('accepts mermaid with code', () => expect(fatal({ title: 't', style: 'mermaid', code: 'graph TD' })).toEqual([]));
  it('rejects a non-array nodes', () => expect(fatal({ title: 't', nodes: {} })).toContain('/nodes'));

  it('accepts a minimal board', () => expect(fatal({ title: 't' })).toEqual([]));
  it('accepts the new clean style', () => expect(fatal({ title: 't', style: 'clean' })).toEqual([]));
});

describe('warning tier: NOT fatal (FR-011, data-model V7)', () => {
  // The whole point of the split. These were rejected outright by the first
  // draft of board.schema.json, which would have blanked a board over a typo.
  it('an unknown kind is not fatal', () => {
    expect(validateFatal({ title: 't', nodes: [{ id: 'a', kind: 'banana' }] })).toEqual([]);
  });

  it('an unknown shape is not fatal', () => {
    expect(validateFatal({ title: 't', nodes: [{ id: 'a', shape: 'blob' }] })).toEqual([]);
  });

  it('a dangling edge is not fatal', () => {
    expect(validateFatal({ title: 't', edges: [{ from: 'a', to: 'ghost' }] })).toEqual([]);
  });

  it('an unknown top-level field is not fatal (FR-012)', () => {
    expect(validateFatal({ title: 't', wibble: 42 })).toEqual([]);
  });
});

describe('parseBoard never throws', () => {
  it('reports unparseable JSON instead of throwing', () => {
    const { spec, result } = parseBoard('{ "title": ');
    expect(spec).toBeUndefined();
    expect(result.fatal[0].message).toMatch(/not valid json/i);
  });

  it('reports a truncated document instead of throwing', () => {
    expect(() => parseBoard('{"answers":[')).not.toThrow();
  });

  it('returns the spec for a valid board', () => {
    const { spec, result } = parseBoard('{"title":"ok","nodes":[]}');
    expect(result.fatal).toEqual([]);
    expect(spec?.title).toBe('ok');
  });
});

describe('LibraryFileName containment (FR-034, SC-009)', () => {
  const reject = [
    '../../../etc/passwd',
    '..',
    '.',
    '/etc/passwd',
    'sub/dir.json',
    'sub\\dir.json',
    '.hidden.json',
    'no-extension',
    'board.json.exe',
    'board.JSON.',
    '',
    'a'.repeat(129) + '.json',
    'board\0.json'
  ];
  for (const bad of reject) {
    it(`rejects ${JSON.stringify(bad)}`, () => expect(isLibraryFileName(bad)).toBe(false));
  }

  const accept = ['board.json', 'my-board.json', 'my_board.2026-09-22.json', 'a.json', 'B9.json'];
  for (const good of accept) {
    it(`accepts ${JSON.stringify(good)}`, () => expect(isLibraryFileName(good)).toBe(true));
  }

  it('rejects non-strings', () => {
    for (const v of [null, undefined, 42, {}, []]) expect(isLibraryFileName(v)).toBe(false);
  });
});

describe('the style list cannot drift from the type (regression)', () => {
  // `drawio` was added to the type, the toolbar and the settings but NOT to
  // the validator, so a board asking for it was rejected as invalid before it
  // ever reached the renderer. These tie every copy back to one list.
  it('the validator accepts every declared render style', () => {
    for (const style of RENDER_STYLES) {
      const extra = style === 'mermaid' ? { code: 'flowchart TB\n a-->b' } : {};
      expect(validateFatal({ title: 't', style, ...extra }), `validator rejected "${style}"`).toEqual([]);
    }
  });

  it('the published schema offers exactly the declared styles', () => {
    const schema = JSON.parse(fs.readFileSync(new URL('../../schemas/board.schema.json', import.meta.url), 'utf8'));
    expect([...schema.properties.style.enum].sort()).toEqual([...RENDER_STYLES].sort());
  });

  it('the settings enum offers exactly the declared styles', () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    const enumValues = manifest.contributes.configuration.properties['agentBoard.defaultStyle'].enum;
    expect([...enumValues].sort()).toEqual([...RENDER_STYLES].sort());
  });
});
