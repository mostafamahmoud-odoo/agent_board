import { describe, expect, it } from 'vitest';
import type { Kind, ThemeKind } from '../../src/shared/types.js';
import { KINDS } from '../../src/shared/types.js';
import { buildPalette, contrastRatio } from '../../src/webview/theme/palette.js';

/**
 * SC-002: 7 kinds x 4 theme kinds = 28 combinations, all WCAG AA.
 *
 * This runs with NO DOM: buildPalette takes an injectable reader, so the gate
 * drives all four theme kinds from fixtures rather than needing a live VS Code.
 */

const THEMES: ThemeKind[] = ['dark', 'light', 'high-contrast-dark', 'high-contrast-light'];

/** Background each theme kind actually paints on. */
const BG: Record<ThemeKind, string> = {
  dark: '#1e1e1e',
  light: '#ffffff',
  'high-contrast-dark': '#000000',
  'high-contrast-light': '#ffffff'
};

/** A reader that returns ONLY the fallback, i.e. the worst case: a theme that
 *  defines none of the charts.* colours, so every variable is absent. */
const barebones = (_name: string, fallback: string) => fallback;

/** A reader simulating a theme whose editor background is set. */
const withBg = (kind: ThemeKind) => (name: string, fallback: string) =>
  name === '--vscode-editor-background'
    ? BG[kind]
    : name === '--vscode-editor-foreground'
      ? (kind === 'light' ? '#3b3b3b' : kind === 'high-contrast-light' ? '#000000' : kind === 'high-contrast-dark' ? '#ffffff' : '#d4d4d4')
      : fallback;

const AA = 4.5;
const AA_LARGE = 3.0;

describe('SC-002: label text meets WCAG AA on its own fill, 7 kinds x 4 themes', () => {
  const failures: string[] = [];

  for (const theme of THEMES) {
    for (const kind of KINDS) {
      it(`${theme} / ${kind}`, () => {
        const p = buildPalette(theme, withBg(theme));
        const k = p.kinds[kind as Kind];
        // In high contrast the fill is transparent by design, so the text sits
        // on the editor background.
        const surface = k.f === 'transparent' ? BG[theme] : k.f;
        const ratio = contrastRatio(surface, k.t);
        if (ratio < AA) failures.push(`${theme}/${kind}: ${ratio.toFixed(2)}`);
        expect(ratio, `${theme}/${kind} text ${k.t} on ${surface}`).toBeGreaterThanOrEqual(AA);
      });
    }
  }

  it('reports the full matrix', () => {
    expect(failures).toEqual([]);
  });
});

describe('strokes are visible against the surface they sit on', () => {
  for (const theme of THEMES) {
    for (const kind of KINDS) {
      it(`${theme} / ${kind} stroke`, () => {
        const p = buildPalette(theme, withBg(theme));
        const k = p.kinds[kind as Kind];
        // A stroke is a large graphical element: AA-large (3.0) is the bar.
        expect(contrastRatio(BG[theme], k.s), `${theme}/${kind} stroke ${k.s}`).toBeGreaterThanOrEqual(AA_LARGE);
      });
    }
  }
});

describe('the seven kinds stay mutually distinguishable (data-model T5, FR-030)', () => {
  for (const theme of THEMES) {
    it(`${theme}: no two kinds share a stroke colour`, () => {
      const p = buildPalette(theme, withBg(theme));
      const strokes = KINDS.map((k) => p.kinds[k as Kind].s.toLowerCase());
      expect(new Set(strokes).size, `strokes: ${strokes.join(', ')}`).toBe(KINDS.length);
    });

    it(`${theme}: every kind is separable WITHOUT colour`, () => {
      // The real guarantee. Someone who cannot distinguish the hues at all -
      // or a high-contrast theme that pushes them together - must still be
      // able to tell the kinds apart.
      const p = buildPalette(theme, withBg(theme));
      const signatures = KINDS.map((k) => {
        const c = p.kinds[k as Kind];
        return `${c.dash ? c.dash.join('-') : 'solid'}|${c.weight}`;
      });
      expect(new Set(signatures).size, `signatures: ${signatures.join(' , ')}`).toBe(KINDS.length);
    });
  }
});

describe('high contrast drops fills rather than tinting them', () => {
  for (const theme of ['high-contrast-dark', 'high-contrast-light'] as ThemeKind[]) {
    it(`${theme}: every kind fill is transparent`, () => {
      const p = buildPalette(theme, withBg(theme));
      for (const k of KINDS) expect(p.kinds[k as Kind].f).toBe('transparent');
    });
    it(`${theme}: frame fill is transparent too`, () => {
      expect(buildPalette(theme, withBg(theme)).frameFill).toBe('transparent');
    });
  }
});

describe('a theme that defines nothing still produces a usable palette', () => {
  // VS Code omits the CSS variable entirely when a theme does not define the
  // colour, so this is not hypothetical.
  for (const theme of THEMES) {
    it(`${theme}: every token is non-empty under a barebones theme`, () => {
      const p = buildPalette(theme, barebones);
      for (const k of KINDS) {
        const c = p.kinds[k as Kind];
        expect(c.s).toBeTruthy();
        expect(c.f).toBeTruthy();
        expect(c.t).toBeTruthy();
      }
      expect(p.ink).toBeTruthy();
      expect(p.edge).toBeTruthy();
      expect(p.focus).toBeTruthy();
    });
  }
});

describe('contrastRatio sanity', () => {
  it('black on white is 21:1', () => expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0));
  it('a colour against itself is 1:1', () => expect(contrastRatio('#808080', '#808080')).toBeCloseTo(1, 5));
  it('handles rgb() as well as hex', () => expect(contrastRatio('rgb(0, 0, 0)', '#ffffff')).toBeCloseTo(21, 0));
});
