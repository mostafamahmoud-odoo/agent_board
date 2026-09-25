/* eslint-disable no-restricted-syntax -- this is THE file colour lives in (FR-021) */
import type { Kind, ThemeKind } from '../../shared/types.js';
import { token } from './tokens.js';

/**
 * The only place colour is decided. A lint rule bans hex literals everywhere
 * else, which is what stops the ~50 hardcoded values the prototype carried
 * from creeping back.
 *
 * WHY NOT JUST `charts.*`: those tokens are the purpose-built diagram palette
 * and we do use them as the hue source, but they cannot carry this alone:
 *
 *   - There are only SIX chart hues and this board has SEVEN kinds.
 *   - charts.red/blue/yellow/orange default to ALIASES of the editor's
 *     error / info / warning / find-match colours. A theme that tints those
 *     similarly collapses them together, and nothing in the registry
 *     guarantees mutual contrast or contrast against editor.background.
 *
 * So kinds are differentiated on TWO channels: hue from charts.* where it
 * fits, plus fill/stroke treatment. That is the same second channel FR-030
 * requires anyway, so it costs nothing extra.
 */

export interface KindColors {
  /** Stroke. */
  s: string;
  /** Fill. */
  f: string;
  /** Text on that fill. */
  t: string;
  /**
   * THE SECOND CHANNEL (FR-030). State must never be carried by colour alone,
   * and in high contrast it literally cannot be: HC wants every stroke at
   * maximum contrast, which pushes hues together. A per-kind dash pattern
   * keeps the seven kinds distinguishable for a user who cannot separate them
   * by hue at all, and costs nothing in the other themes.
   *
   * `null` = solid.
   */
  dash: number[] | null;
  /** Stroke width multiplier — the third, coarsest channel. */
  weight: number;
}

export interface Palette {
  kind: ThemeKind;
  highContrast: boolean;
  ink: string;
  frameStroke: string;
  frameFill: string;
  frameTitle: string;
  edge: string;
  chip: string;
  focus: string;
  muted: string;
  sticky: { fill: string; text: string };
  pen: string;
  kinds: Record<Kind, KindColors>;
}

/** Last-resort fallbacks, used only when a theme defines no such colour. */
const FALLBACK = {
  dark: { bg: '#1e1e1e', fg: '#d4d4d4', widget: '#252526', border: '#454545' },
  light: { bg: '#ffffff', fg: '#3b3b3b', widget: '#f3f3f3', border: '#c8c8c8' }
};

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function parseColor(c: string): [number, number, number] | null {
  const hex = hexToRgb(c);
  if (hex) return hex;
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(c);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function luminance(c: string): number {
  const rgb = parseColor(c);
  if (!rgb) return 0;
  const srgb = rgb.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Picks whichever of two candidates reads better on `bg`. */
export function readableOn(bg: string, light: string, dark: string): string {
  return contrastRatio(bg, light) >= contrastRatio(bg, dark) ? light : dark;
}

/**
 * Nudges `color` away from `bg` until it clears `target`.
 *
 * This is what makes the contrast gate pass BY CONSTRUCTION rather than by a
 * hand-tuned constant. A theme is free to supply any charts.* value it likes,
 * including one that is nearly its own background; this keeps the board
 * legible anyway.
 */
export function ensureRatio(bg: string, color: string, target: number): string {
  if (contrastRatio(bg, color) >= target) return color;
  const toward = luminance(bg) > 0.4 ? '#000000' : '#ffffff';
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mix(color, toward, t);
    if (contrastRatio(bg, c) >= target) return c;
  }
  return toward;
}

function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * Builds the palette for a theme kind. `reader` is injectable so the contrast
 * gate can drive all four theme kinds without a DOM.
 */
export function buildPalette(kind: ThemeKind, reader: (name: string, fallback: string) => string = token): Palette {
  const hc = kind === 'high-contrast-dark' || kind === 'high-contrast-light';
  const isLight = kind === 'light' || kind === 'high-contrast-light';
  const fb = isLight ? FALLBACK.light : FALLBACK.dark;

  const bg = reader('--vscode-editor-background', fb.bg);
  const fg = reader('--vscode-editor-foreground', fb.fg);
  const widget = reader('--vscode-editorWidget-background', fb.widget);
  const border = reader('--vscode-editorWidget-border', reader('--vscode-widget-border', fb.border));
  const focus = reader('--vscode-focusBorder', isLight ? '#005fb8' : '#007fd4');

  // Hue source. Fallbacks are required: an undefined theme colour emits no
  // variable at all.
  const hue = {
    red: reader('--vscode-charts-red', isLight ? '#c4314b' : '#f14c4c'),
    blue: reader('--vscode-charts-blue', isLight ? '#1a72c4' : '#3794ff'),
    green: reader('--vscode-charts-green', isLight ? '#388a34' : '#89d185'),
    orange: reader('--vscode-charts-orange', isLight ? '#b5620a' : '#d18616'),
    purple: reader('--vscode-charts-purple', isLight ? '#652d90' : '#b180d7'),
    yellow: reader('--vscode-charts-yellow', isLight ? '#8f6a00' : '#cca700')
  };

  /**
   * In high contrast, fills drop to transparent and differentiation moves to
   * stroke and label — a fill that is nearly the background is exactly what HC
   * users cannot see.
   */
  const shade = (c: string) => (hc ? 'transparent' : mix(bg, c, isLight ? 0.1 : 0.16));
  /**
   * Strokes are large graphical elements: AA-large, with headroom. In high
   * contrast the bar is much higher (7:1) but the HUE IS KEPT rather than
   * collapsed to the foreground - otherwise all seven kinds become one colour
   * and the only thing telling them apart is the dash pattern.
   */
  const stroke = (c: string) => ensureRatio(bg, c, hc ? 7 : 3.2);
  const onShade = (c: string) => (hc ? fg : readableOn(mix(bg, c, isLight ? 0.1 : 0.16), '#ffffff', '#1a1a1a'));

  const kinds: Record<Kind, KindColors> = {
    base: { s: stroke(hue.blue), f: shade(hue.blue), t: onShade(hue.blue), dash: null, weight: 1 },
    problem: { s: stroke(hue.red), f: shade(hue.red), t: onShade(hue.red), dash: null, weight: 1.6 },
    fix: { s: stroke(hue.green), f: shade(hue.green), t: onShade(hue.green), dash: [7, 4], weight: 1 },
    data: { s: stroke(hue.orange), f: shade(hue.orange), t: onShade(hue.orange), dash: [2, 3], weight: 1 },
    accent: { s: stroke(hue.purple), f: shade(hue.purple), t: onShade(hue.purple), dash: [10, 3, 2, 3], weight: 1 },
    // `note` is a sticky: it is differentiated by TREATMENT (folded corner,
    // warm fill), not by a sixth hue - which is how seven kinds fit into six.
    note: {
      s: stroke(hue.yellow),
      f: hc ? 'transparent' : isLight ? '#fff6c2' : '#4a3f10',
      t: hc ? fg : isLight ? '#3b3b3b' : '#f5e6a8',
      // The folded corner of the sticky shape is `note`'s real second channel.
      dash: null,
      weight: 0.8
    },
    // `muted` is deliberately hue-less: background context.
    muted: {
      s: stroke(mix(bg, fg, 0.55)),
      f: hc ? 'transparent' : mix(bg, fg, 0.07),
      t: hc ? fg : mix(bg, fg, 0.75),
      dash: [3, 4],
      weight: 0.7
    }
  };

  return {
    kind,
    highContrast: hc,
    ink: fg,
    // contrastBorder is absent in normal themes (VS Code omits undefined
    // colours entirely), so this yields a free HC outline and costs nothing
    // elsewhere.
    frameStroke: reader('--vscode-contrastBorder', hc ? fg : border),
    frameFill: hc ? 'transparent' : mix(bg, fg, 0.04),
    frameTitle: mix(bg, fg, 0.7),
    edge: reader('--vscode-charts-lines', mix(bg, fg, 0.55)),
    chip: widget,
    focus,
    muted: mix(bg, fg, 0.6),
    sticky: kinds.note.f === 'transparent' ? { fill: 'transparent', text: fg } : { fill: kinds.note.f, text: kinds.note.t },
    pen: hue.orange,
    kinds
  };
}

export function kindOf(p: Palette, k: Kind | undefined): KindColors {
  return p.kinds[k ?? 'base'] ?? p.kinds.base;
}
