import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * FR-020: the renderer and SKILL.md may not drift.
 *
 * This matters more than ordinary doc rot, because SKILL.md is not
 * documentation for humans — it is the PROMPT THAT GENERATES THE INPUT. When
 * it drifts from the renderer, Claude writes fields that are silently
 * ignored, and the user sees a board that quietly does not match what was
 * asked for.
 *
 * They had already drifted in both directions before this test existed.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const skill = fs.readFileSync(path.join(root, 'skill/SKILL.md'), 'utf8');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas/board.schema.json'), 'utf8'));

/** Every property name the schema defines, anywhere. */
function schemaFields(node: unknown, out = new Set<string>()): Set<string> {
  if (!node || typeof node !== 'object') return out;
  const o = node as Record<string, unknown>;
  if (o.properties && typeof o.properties === 'object') {
    for (const k of Object.keys(o.properties as object)) out.add(k);
  }
  for (const v of Object.values(o)) {
    if (Array.isArray(v)) v.forEach((x) => schemaFields(x, out));
    else if (v && typeof v === 'object') schemaFields(v, out);
  }
  return out;
}

const fields = schemaFields(schema);

/** Fields the schema marks deprecated are accepted but not advertised. */
function deprecated(node: unknown, out = new Set<string>()): Set<string> {
  if (!node || typeof node !== 'object') return out;
  const o = node as Record<string, unknown>;
  if (o.properties && typeof o.properties === 'object') {
    for (const [k, v] of Object.entries(o.properties as Record<string, Record<string, unknown>>)) {
      if (v && v.deprecated === true) out.add(k);
    }
  }
  for (const v of Object.values(o)) {
    if (Array.isArray(v)) v.forEach((x) => deprecated(x, out));
    else if (v && typeof v === 'object') deprecated(v, out);
  }
  return out;
}

const deprecatedFields = deprecated(schema);

describe('schema <-> SKILL.md reconciliation (FR-020)', () => {
  it('the schema defines a meaningful number of fields', () => {
    expect(fields.size).toBeGreaterThan(40);
  });

  it('every NON-deprecated schema field is mentioned in SKILL.md', () => {
    // A field the renderer honours that the skill never mentions is a field
    // Claude will never write.
    const undocumented = [...fields]
      .filter((f) => !deprecatedFields.has(f))
      .filter((f) => !new RegExp(`\\b${f.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`).test(skill));
    expect(undocumented, `in the schema but absent from SKILL.md: ${undocumented.join(', ')}`).toEqual([]);
  });

  it('deprecated aliases are accepted but NOT advertised as the spelling to use', () => {
    // They exist so old saved boards keep opening (SC-005). The skill should
    // not teach Claude to write them.
    expect([...deprecatedFields].sort()).toEqual(['groups', 'h', 'notes', 'source', 'target', 'w', 'x', 'y']);
  });

  it('SKILL.md documents the three render styles', () => {
    for (const s of ['sketchy', 'mermaid', 'clean']) {
      expect(skill.toLowerCase(), `SKILL.md never mentions the "${s}" style`).toContain(s);
    }
  });

  it('SKILL.md documents all seven kinds', () => {
    for (const k of ['base', 'problem', 'fix', 'data', 'accent', 'note', 'muted']) {
      expect(skill).toContain(k);
    }
  });

  it('SKILL.md documents all seven shapes', () => {
    for (const s of ['rect', 'round', 'pill', 'ellipse', 'diamond', 'cyl']) {
      expect(skill).toContain(s);
    }
  });
});

describe('SKILL.md documents how the draw.io canvas differs (FR-020)', () => {
  /*
   * SKILL.md is the prompt that generates the board, so a difference the
   * canvas has and the skill does not mention is a board Claude will write
   * wrong. These pin the three that change what gets authored, each against
   * the code that makes them true.
   */
  const main = fs.readFileSync(path.join(root, 'src/webview/main.ts'), 'utf8');
  const drawio = fs.readFileSync(path.join(root, 'src/webview/render/to-drawio.ts'), 'utf8');

  it('says a board with questions must ask for sketchy', () => {
    // The canvas replaces the whole panel body, so the questions tray is not
    // reachable while it is up.
    expect(main).toContain("effective === 'drawio'");
    expect(skill.toLowerCase()).toMatch(/questions[\s\S]{0,200}sketchy|sketchy[\s\S]{0,200}questions/);
  });

  it('warns that a user edit freezes the board against later writes', () => {
    expect(main).toContain('drawioForTitle === spec.title');
    expect(skill).toMatch(/freeze|frozen|ignored|reopens/i);
  });

  it('says hatch fades rather than hatches on this canvas', () => {
    expect(drawio).toContain("opacity: spec?.hatch === true ? 55 : undefined");
    expect(skill).toMatch(/hatch[\s\S]{0,160}(fade|opacity)/i);
  });
});
