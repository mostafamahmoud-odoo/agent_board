import type { BoardSpec } from '../../shared/types.js';
import type { Palette } from '../theme/palette.js';

/**
 * Mermaid, loaded on demand.
 *
 * WHY A SCRIPT TAG AND NOT `import()`: the vendored bundle is UMD, not ESM.
 * `await import(url)` on it resolves to a module namespace that does not carry
 * the API — the factory has already assigned itself to `globalThis.mermaid` —
 * so calling `mod.initialize` threw "initialize is not a function". Loading it
 * as a classic script and reading the global is what a UMD bundle expects.
 *
 * It is still only fetched when a mermaid board actually renders; the
 * prototype pulled all 3.3 MB synchronously on every panel open.
 */

interface MermaidApi {
  initialize(cfg: Record<string, unknown>): void;
  render(id: string, code: string): Promise<{ svg: string }>;
}

let loading: Promise<MermaidApi> | null = null;
let themedFor: string | null = null;

function nonce(): string {
  // Reuse the nonce the host stamped on our own module script; a dynamically
  // injected script needs it or the CSP refuses to run it.
  const s = document.querySelector('script[nonce]') as HTMLScriptElement | null;
  return s?.nonce || s?.getAttribute('nonce') || '';
}

function loadMermaid(): Promise<MermaidApi> {
  if (loading) return loading;

  loading = new Promise<MermaidApi>((resolve, reject) => {
    const existing = (window as unknown as { mermaid?: MermaidApi }).mermaid;
    if (existing && typeof existing.initialize === 'function') return resolve(existing);

    const url = document.body.dataset.mermaidUri;
    if (!url) return reject(new Error('the mermaid asset URL is missing from the panel shell'));

    const el = document.createElement('script');
    el.src = url;
    const n = nonce();
    if (n) el.setAttribute('nonce', n);
    el.onload = () => {
      const api = (window as unknown as { mermaid?: MermaidApi }).mermaid;
      if (api && typeof api.initialize === 'function') resolve(api);
      else reject(new Error('mermaid loaded but did not expose its API'));
    };
    el.onerror = () => reject(new Error('mermaid could not be loaded from the extension bundle'));
    document.head.appendChild(el);
  }).catch((e) => {
    loading = null; // let a later board try again
    throw e;
  });

  return loading;
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

      const code = String(spec.code ?? '').trim();
      if (!code) throw new Error('this board has style "mermaid" but no `code`');

      const id = 'mmd-' + Math.random().toString(36).slice(2, 9);
      const { svg } = await m.render(id, code);

      // Parsed as a document, never innerHTML: board content is agent-written.
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const root = doc.documentElement;
      if (root.nodeName.toLowerCase() !== 'svg') {
        throw new Error(doc.querySelector('parsererror')?.textContent || 'mermaid did not return an SVG');
      }
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
