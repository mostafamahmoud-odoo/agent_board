import type { ThemeKind } from '../../shared/types.js';

/**
 * Reads VS Code's theme from the webview.
 *
 * Three facts from VS Code's own implementation drive this file:
 *
 * 1. CSS variables are set on `document.documentElement`, NOT on body — but
 *    the theme CLASSES and `data-vscode-theme-kind` land on body.
 * 2. If a theme does not define a colour, the variable is NOT EMITTED AT ALL
 *    (`if (color)` in themeing.ts). So every read needs a fallback, or the
 *    board goes invisible in someone else's theme.
 * 3. High-contrast light carries BOTH `vscode-high-contrast-light` and
 *    `vscode-high-contrast` (for backward compatibility), so class-based
 *    detection must test the specific one first. `data-vscode-theme-kind`
 *    avoids the trap entirely, which is what we use.
 *
 * There is no theme-change event in a webview; a MutationObserver on body is
 * the supported pattern.
 */

export interface ThemeSignals {
  kind: ThemeKind;
  highContrast: boolean;
  reduceMotion: boolean;
  screenReader: boolean;
}

/** Reads a --vscode-* custom property, with a mandatory fallback. */
export function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function readThemeKind(): ThemeKind {
  const attr = document.body.dataset.vscodeThemeKind || '';
  if (attr === 'vscode-high-contrast-light') return 'high-contrast-light';
  if (attr === 'vscode-high-contrast') return 'high-contrast-dark';
  if (attr === 'vscode-light') return 'light';
  if (attr === 'vscode-dark') return 'dark';

  // Fallback for older hosts that set only classes.
  const c = document.body.classList;
  if (c.contains('vscode-high-contrast-light')) return 'high-contrast-light';
  if (c.contains('vscode-high-contrast')) return 'high-contrast-dark';
  if (c.contains('vscode-light')) return 'light';
  return 'dark';
}

export function readSignals(): ThemeSignals {
  const kind = readThemeKind();
  return {
    kind,
    highContrast: kind === 'high-contrast-dark' || kind === 'high-contrast-light',
    // The CLASS beats @media (prefers-reduced-motion): it honours VS Code's
    // own `workbench.reduceMotion`, whose "auto" already consults the OS. The
    // bare media query would ignore a user who set it to "on" explicitly.
    reduceMotion:
      document.body.classList.contains('vscode-reduce-motion') ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
    screenReader: document.body.classList.contains('vscode-using-screen-reader')
  };
}

/**
 * Observes body for theme/class changes. The host applies classes to body and
 * variables to documentElement in the same call, so a body mutation is a
 * reliable trigger for both.
 */
export function observeTheme(onChange: (s: ThemeSignals) => void): () => void {
  let last = JSON.stringify(readSignals());
  const obs = new MutationObserver(() => {
    const next = readSignals();
    const key = JSON.stringify(next);
    if (key !== last) {
      last = key;
      onChange(next);
    }
  });
  obs.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'data-vscode-theme-kind', 'data-vscode-theme-id']
  });
  return () => obs.disconnect();
}
