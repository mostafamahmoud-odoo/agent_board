/**
 * Text metrics, behind an injectable port.
 *
 * WHY A PORT: layout must be testable without a DOM, and neither fake DOM
 * works for SVG. jsdom has no `getBBox` at all (the renderer throws
 * `TypeError`), and happy-dom provides it but returns zeros — which is worse,
 * because layout then runs to completion with every element at (0,0) and a
 * snapshot test passes while asserting nothing. Tests supply a deterministic
 * stub instead; production supplies the canvas-backed measurer below.
 */

export const FS_LABEL = 15;
export const LH_LABEL = 19;
export const FS_SUB = 12;
export const LH_SUB = 15;
export const FS_TITLE = 13;
export const FS_EDGE = 12;
export const FS_NOTE = 14;
export const FS_CELL = 12;
export const FS_SCR = 12;
export const PAD_X = 14;
export const PAD_Y = 12;

/**
 * The hand-drawn face.
 *
 * NOTE the absence of a bare `cursive` fallback. None of the named faces ship
 * with most Linux installs, and generic `cursive` there is usually a formal
 * script that looks nothing like handwriting and is hard to read at 12px. A
 * clean UI font is a far better degradation than the wrong hand font.
 */
export const INK_FONT =
  "'Comic Sans MS', 'Chalkboard SE', 'Segoe Print', 'Bradley Hand', 'Comic Neue', ui-rounded, system-ui, sans-serif";

export interface TextMeasurer {
  /** Advance width of `str` at `size` px, optionally bold. */
  width(str: string, size: number, bold?: boolean): number;
}

/**
 * Real advance widths from a shared canvas 2d context, so boxes are sized to
 * the text that will actually be painted rather than a per-character guess.
 */
export function createCanvasMeasurer(): TextMeasurer {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
  } catch {
    ctx = null;
  }
  // Degrade rather than die. A missing 2d context used to throw at module
  // load, which took the whole panel down instead of costing a little layout
  // accuracy; the approximation is what the board falls back to.
  if (!ctx) return createFixedMeasurer();

  const c = ctx;
  return {
    width(str, size, bold) {
      c.font = (bold ? 'bold ' : '') + size + 'px ' + INK_FONT;
      const w = c.measureText(str).width;
      // Some hosts return 0 for everything; that silently collapses the board.
      return Number.isFinite(w) && w > 0 ? w : String(str).length * size * 0.55;
    }
  };
}

/** Deterministic measurer for tests: no DOM, no font dependency, no flake. */
export function createFixedMeasurer(perChar = 0.55): TextMeasurer {
  return {
    width(str, size, bold) {
      return String(str).length * size * perChar * (bold ? 1.06 : 1);
    }
  };
}

/**
 * Greedy word wrap with a hard split for any single word wider than `maxW`.
 * Explicit `\n` is honoured. Always returns at least one line, so callers can
 * safely take `lines.length` and `Math.max(...)` over the result.
 */
export function wrap(text: unknown, maxW: number, size: number, m: TextMeasurer): string[] {
  const out: string[] = [];
  String(text == null ? '' : text)
    .split('\n')
    .forEach((para) => {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) {
        out.push('');
        return;
      }
      let line = '';
      for (let word of words) {
        while (m.width(word, size) > maxW) {
          let cut = word.length - 1;
          while (cut > 1 && m.width(word.slice(0, cut), size) > maxW) cut--;
          if (line) {
            out.push(line);
            line = '';
          }
          out.push(word.slice(0, cut));
          word = word.slice(cut);
        }
        const probe = line ? line + ' ' + word : word;
        if (m.width(probe, size) <= maxW) line = probe;
        else {
          if (line) out.push(line);
          line = word;
        }
      }
      if (line) out.push(line);
    });
  return out.length ? out : [''];
}

/** Widest line in a wrapped block. Safe on an empty array. */
export function widestLine(lines: string[], size: number, m: TextMeasurer): number {
  let w = 0;
  for (const l of lines) w = Math.max(w, m.width(l, size));
  return w;
}

/**
 * Stable FNV-1a seed per element id, so rough.js redraws the same wobble on
 * every re-render and a spec edit does not reshuffle the whole board.
 */
export function seedOf(str: string): number {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 100000;
}
