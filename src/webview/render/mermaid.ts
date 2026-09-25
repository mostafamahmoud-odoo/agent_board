import type { BoardSpec } from '../../shared/types.js';
import type { Palette } from '../theme/palette.js';

/**
 * Mermaid, loaded on demand.
 *
 * The prototype pulled 3.3 MB synchronously on EVERY panel open, before
 * rough.js and before the app script, and initialised it eagerly - even
 * though most boards are sketchy and never touch it. This module is reached
 * only by a dynamic import when a mermaid board actually renders.
 */

interface MermaidApi {
  initialize(cfg: Record<string, unknown>): void;
  render(id: string, code: string): Promise<{ svg: string }>;
}

let api: MermaidApi | null = null;
let themedFor: string | null = null;

async function loadMermaid(): Promise<MermaidApi> {
  if (api) return api;
  const url = document.body.dataset.mermaidUri;
  if (!url) throw new Error('mermaid asset URL missing from the panel shell');
  const mod = (await import(/* @vite-ignore */ url)) as { default?: MermaidApi } & MermaidApi;
  api = (mod.default ?? mod) as MermaidApi;
  return api;
}

export function createMermaidRenderer() {
  return {
    id: 'mermaid' as const,
    async renderAsync(spec: BoardSpec, p: Palette): Promise<SVGSVGElement> {
      const m = await loadMermaid();
      // Re-initialise on a theme change: the prototype fixed the theme once at
      // load, so a mermaid board stayed in the old theme permanently.
      if (themedFor !== p.kind) {
        m.initialize({
          startOnLoad: false,
          // Strictest level that still renders the supported diagram types.
          // 'loose' (the prototype's setting) permits HTML and click handlers
          // in labels, which is too much reach for agent-written content.
          securityLevel: 'strict',
          theme: p.kind === 'light' || p.kind === 'high-contrast-light' ? 'default' : 'dark',
          themeVariables: { fontFamily: 'var(--vscode-font-family)' }
        });
        themedFor = p.kind;
      }
      const id = 'mmd-' + Math.random().toString(36).slice(2, 9);
      const { svg } = await m.render(id, String(spec.code ?? ''));

      // Parsed as a document, never innerHTML: board content is agent-written.
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const root = doc.documentElement;
      if (root.nodeName.toLowerCase() !== 'svg') throw new Error('mermaid did not return an SVG');
      // Strip anything scriptable that survived the parse.
      for (const bad of Array.from(root.querySelectorAll('script, foreignObject a[href^="javascript:"]'))) {
        bad.remove();
      }
      const imported = document.importNode(root, true) as unknown as SVGSVGElement;
      imported.setAttribute('role', 'graphics-document');
      imported.setAttribute('aria-label', `Diagram: ${spec.title}`);
      return imported;
    }
  };
}
