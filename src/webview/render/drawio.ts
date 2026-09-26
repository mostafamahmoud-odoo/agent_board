import type { BoardSpec } from '../../shared/types.js';
import type { LayoutResult } from '../layout/types.js';
import type { Palette } from '../theme/palette.js';
import { layoutToDrawio } from './to-drawio.js';

/**
 * draw.io as the canvas, embedded in an iframe.
 *
 * WHY AN IFRAME: the app brings its own CSS and scripts, and an iframe gives
 * it its own document so its needs never force us to weaken the panel's own
 * policy. That is the lesson from the draw.io extension — and the thing I got
 * wrong with mermaid, where I relaxed `style-src` instead.
 *
 * Our layout still decides where everything starts, so a board opens looking
 * like the board Claude drew; draw.io owns editing from there.
 *
 * The embed protocol is postMessage-based: we send `load`, it sends back
 * `init`, `save`, `autosave` and `exit`.
 */

export interface DrawioEvents {
  /** The user changed the diagram. `xml` is the whole mxfile. */
  onEdit(xml: string): void;
  /** The embed is up and has been given a board. */
  onReady?(): void;
  onError?(message: string): void;
}

interface EmbedMessage {
  event?: string;
  xml?: string;
  message?: { message?: string };
}

export class DrawioCanvas {
  private frame: HTMLIFrameElement | null = null;
  private ready = false;
  private pending: string | null = null;
  private listener: ((e: MessageEvent) => void) | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly embedUrl: string,
    private readonly events: DrawioEvents
  ) {}

  /** True once the embed has handshaken. */
  get isReady(): boolean {
    return this.ready;
  }

  mount(): void {
    if (this.frame) return;
    const f = document.createElement('iframe');
    f.id = 'drawio';
    f.setAttribute('title', 'Board editor');
    f.setAttribute('frameborder', '0');
    // The embed app is a separate document; nothing of ours leaks in.
    f.src = this.embedUrl;
    this.host.appendChild(f);
    this.frame = f;

    this.listener = (e: MessageEvent) => this.onMessage(e);
    window.addEventListener('message', this.listener);
  }

  dispose(): void {
    if (this.listener) window.removeEventListener('message', this.listener);
    this.listener = null;
    this.frame?.remove();
    this.frame = null;
    this.ready = false;
  }

  /** Renders a board. Queued until the embed handshakes. */
  load(layout: LayoutResult, spec: BoardSpec, palette: Palette, sketch: boolean): void {
    const xml = layoutToDrawio(layout, spec.title, palette, { sketch });
    this.loadXml(xml);
  }

  loadXml(xml: string): void {
    if (!this.ready) {
      this.pending = xml;
      return;
    }
    this.post({ action: 'load', xml, autosave: 1 });
  }

  /** Asks the embed for the current diagram; the answer arrives as an edit. */
  requestExport(): void {
    this.post({ action: 'export', format: 'xmlsvg' });
  }

  private post(msg: Record<string, unknown>): void {
    this.frame?.contentWindow?.postMessage(JSON.stringify(msg), '*');
  }

  private onMessage(e: MessageEvent): void {
    // Only listen to our own frame.
    if (!this.frame || e.source !== this.frame.contentWindow) return;
    let data: EmbedMessage;
    try {
      data = typeof e.data === 'string' ? JSON.parse(e.data) : (e.data as EmbedMessage);
    } catch {
      return; // not an embed message
    }
    if (!data || typeof data.event !== 'string') return;

    switch (data.event) {
      case 'init':
        this.ready = true;
        this.post({
          action: 'configure',
          config: {
            // Keep the panel's chrome the single source of truth for theme.
            defaultFonts: ['Comic Sans MS', 'Helvetica'],
            sketchFontFamily: 'Comic Sans MS'
          }
        });
        if (this.pending) {
          this.post({ action: 'load', xml: this.pending, autosave: 1 });
          this.pending = null;
        }
        this.events.onReady?.();
        return;

      case 'load':
        // The embed opens wherever it last was, so a freshly loaded diagram
        // can be sitting off-screen — indistinguishable from "nothing
        // rendered". Ask for a reset and a fit; the two action names differ
        // between draw.io builds, and an unknown one is simply ignored.
        for (const actionName of ['resetView', 'fitWindow', 'fitPage']) {
          this.post({ action: 'invokeAction', actionName });
        }
        return;

      case 'autosave':
      case 'save':
        if (typeof data.xml === 'string') this.events.onEdit(data.xml);
        return;

      case 'export':
        if (typeof data.xml === 'string') this.events.onEdit(data.xml);
        return;

      case 'configure':
        return;

      default:
        return;
    }
  }
}

/**
 * Where the embed app is served from.
 *
 * Deliberately NOT vendored: the draw.io app is ~107 MB, which would take the
 * extension from 1 MB to something no one wants to install from a
 * marketplace. The default is the official embed host; a workspace that must
 * work offline points this at a local copy instead.
 */
export function resolveEmbedUrl(configured: string | undefined, dark = true): string {
  const base = (configured || 'https://embed.diagrams.net/').trim();
  const sep = base.includes('?') ? '&' : '?';
  // embed=1 + proto=json is the postMessage protocol; the rest trims chrome
  // we do not want inside a side panel. `dark` follows the editor theme so
  // the canvas does not fight it.
  return (
    `${base}${sep}embed=1&proto=json&spin=1&libraries=0` +
    `&noSaveBtn=1&noExitBtn=1&saveAndExit=0&ui=${dark ? 'dark' : 'min'}&dark=${dark ? 1 : 0}`
  );
}
