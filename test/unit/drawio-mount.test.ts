import { describe, expect, it, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { DrawioCanvas, resolveEmbedUrl } from '../../src/webview/render/drawio.js';

/*
 * The draw.io canvas came back blank in the real panel and in every capture.
 * The cause was not the protocol: the iframe was mounted inside #viewport,
 * which carries the pan/zoom transform and `will-change: transform`. Either
 * makes it the containing block for a position:fixed descendant, so
 * `inset: 0` sized against a div that had just been emptied — 0x0. These
 * tests pin the two things that made it invisible.
 */
describe('the draw.io canvas is mounted outside the pan/zoom transform', () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body><div id="canvas"><div id="viewport"></div></div></body>', {
      url: 'https://example.invalid/'
    });
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('window', dom.window);
  });

  const make = (host: HTMLElement) =>
    new DrawioCanvas(host as never, resolveEmbedUrl(''), { onEdit: () => {} });

  it('mounts the iframe on the host it is given, not on #viewport', () => {
    const body = dom.window.document.body as unknown as HTMLElement;
    make(body).mount();
    const frame = dom.window.document.getElementById('drawio');
    expect(frame, 'no iframe was mounted').not.toBeNull();
    expect(frame!.parentElement!.id).toBe('');
    expect(frame!.parentElement!.tagName).toBe('BODY');
    expect(dom.window.document.getElementById('viewport')!.contains(frame!)).toBe(false);
  });

  it('shows what it is waiting for instead of an empty panel', () => {
    make(dom.window.document.body as unknown as HTMLElement).mount();
    const status = dom.window.document.getElementById('drawio-status');
    expect(status, 'the canvas mounted with no status of any kind').not.toBeNull();
    expect(status!.dataset.state).toBe('waiting');
    expect(status!.textContent).toContain('embed.diagrams.net');
  });

  it('reports a failure, with the origin, when no handshake arrives', () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    new DrawioCanvas(dom.window.document.body as unknown as HTMLElement as never, resolveEmbedUrl(''), {
      onEdit: () => {},
      onError
    }).mount();
    vi.advanceTimersByTime(13000);
    const status = dom.window.document.getElementById('drawio-status');
    expect(status!.dataset.state).toBe('failed');
    expect(status!.textContent).toContain('did not respond');
    expect(onError).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

describe('the embed handshake is actually wired up', () => {
  // A refactor once dropped the window 'message' listener while everything
  // else still compiled and mounted; the canvas simply never handshook.
  it('listens for the embed init and stops reporting "waiting"', () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.invalid/' });
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('window', dom.window);

    const onReady = vi.fn();
    const canvas = new DrawioCanvas(
      dom.window.document.body as unknown as HTMLElement as never,
      resolveEmbedUrl(''),
      { onEdit: () => {}, onReady }
    );
    canvas.mount();
    expect(canvas.isReady).toBe(false);

    // `source` is read-only on MessageEvent, so it is passed in the init dict
    // — the canvas checks it to ignore messages from anything but its frame.
    const frame = dom.window.document.getElementById('drawio') as HTMLIFrameElement;
    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: JSON.stringify({ event: 'init' }),
        source: frame.contentWindow
      })
    );

    expect(canvas.isReady, 'init arrived but the canvas never handshook').toBe(true);
    expect(onReady).toHaveBeenCalledOnce();
    expect(dom.window.document.getElementById('drawio-status')).toBeNull();
  });
});
