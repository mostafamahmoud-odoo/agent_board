import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import type { HostToWebview } from '../shared/protocol.js';

/**
 * Webview lifecycle, the nonce CSP, and the hidden-panel message queue.
 *
 * THE BUG THIS FIXES: the prototype set `retainContextWhenHidden: true` and
 * posted `render` on every file change with no visibility check. The published
 * webview guide says that flag keeps scripts running and that you may message
 * a hidden webview — but `vscode.d.ts` states the opposite: a hidden webview's
 * scripts are SUSPENDED and it CANNOT be messaged even with the flag. The
 * .d.ts is the API contract and the newer text, so renders sent while the user
 * had tabbed away could simply be dropped, leaving a silently stale board.
 *
 * Here: no retainContextWhenHidden, and messages are queued while hidden and
 * flushed on reveal. Only the newest `render` is kept — an older board is
 * never worth delivering.
 */

const VIEW_TYPE = 'claudeNotes';

export class NotesPanel {
  private queue: HostToWebview[] = [];
  private disposables: vscode.Disposable[] = [];

  private constructor(
    public readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri
  ) {
    this.panel.webview.html = this.html();

    this.disposables.push(
      this.panel.onDidChangeViewState(() => {
        if (this.panel.visible) this.flush();
      })
    );
  }

  static create(extensionUri: vscode.Uri): NotesPanel {
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Claude Notes',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      NotesPanel.webviewOptions(extensionUri)
    );
    return new NotesPanel(panel, extensionUri);
  }

  static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): NotesPanel {
    // Re-set the options on revive so localResourceRoots picks up the current
    // extension URI rather than whatever was serialized.
    panel.webview.options = NotesPanel.webviewOptions(extensionUri);
    return new NotesPanel(panel, extensionUri);
  }

  static webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
      enableScripts: true,
      // Deliberately NOT retainContextWhenHidden: per vscode.d.ts it suspends
      // scripts and blocks messaging anyway, while keeping the parsed mermaid
      // bundle resident for the whole session.
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'media'),
        vscode.Uri.joinPath(extensionUri, 'dist')
      ]
    };
  }

  get webview(): vscode.Webview {
    return this.panel.webview;
  }

  get visible(): boolean {
    return this.panel.visible;
  }

  onDidReceiveMessage(cb: (msg: unknown) => void): void {
    this.disposables.push(this.panel.webview.onDidReceiveMessage(cb));
  }

  onDidDispose(cb: () => void): void {
    this.disposables.push(this.panel.onDidDispose(cb));
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside, true);
  }

  /** Queues while hidden; only the latest render survives the queue. */
  post(msg: HostToWebview): void {
    if (!this.panel.visible) {
      if (msg.type === 'render') this.queue = this.queue.filter((m) => m.type !== 'render');
      this.queue.push(msg);
      if (this.queue.length > 64) this.queue.splice(0, this.queue.length - 64);
      return;
    }
    void this.panel.webview.postMessage(msg);
  }

  private flush(): void {
    const pending = this.queue;
    this.queue = [];
    for (const m of pending) void this.panel.webview.postMessage(m);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.panel.dispose();
  }

  private html(): string {
    const w = this.panel.webview;
    const nonce = makeNonce();
    const shell = path.join(this.extensionUri.fsPath, 'media', 'panel.html');
    const uri = (...parts: string[]) => w.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...parts)).toString();

    /*
     * SCRIPTS stay strict: nonce only, no 'unsafe-inline'. That is the
     * directive that matters for agent-written board content.
     *
     * STYLES need 'unsafe-inline'. Mermaid injects a <style> element and sets
     * `style="..."` on the nodes it draws, and it offers no way to carry a
     * nonce — so a tight style-src renders the diagram completely unstyled.
     * Measured: 55 style-src violations for a two-node flowchart. Inline CSS
     * cannot execute, and mermaid itself runs at securityLevel 'strict', so
     * this buys a working diagram at a cost confined to styling.
     *
     * NOTE: a nonce must NOT be added to style-src as well — a nonce makes
     * 'unsafe-inline' be ignored, which would put us straight back.
     */
    const embed = vscode.workspace.getConfiguration('claudeNotes').get<string>('drawioUrl', '') ||
      'https://embed.diagrams.net/';
    const frameOrigin = (() => {
      try {
        return new URL(embed).origin;
      } catch {
        return 'https://embed.diagrams.net';
      }
    })();

    const csp = [
      "default-src 'none'",
      `frame-src ${frameOrigin} ${w.cspSource}`,
      `style-src ${w.cspSource} 'unsafe-inline'`,
      `img-src ${w.cspSource} https: data:`,
      `font-src ${w.cspSource} data:`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    let html: string;
    try {
      html = fs.readFileSync(shell, 'utf8');
    } catch {
      html = FALLBACK_SHELL;
    }

    return html
      .replace(/{{csp}}/g, csp)
      .replace(/{{cspSource}}/g, w.cspSource)
      .replace(/{{nonce}}/g, nonce)
      .replace(/{{scriptUri}}/g, uri('dist', 'webview.js'))
      .replace(/{{styleUri}}/g, uri('dist', 'webview.css'))
      .replace(/{{mermaidUri}}/g, uri('media', 'vendor', 'mermaid.min.js'))
      .replace(/{{drawioUrl}}/g, embed)
      .replace(/{{drawioSketch}}/g, String(vscode.workspace.getConfiguration('claudeNotes').get<boolean>('drawioSketch', true)));
  }
}

/** A fresh nonce per html assignment — never cached. */
export function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

const FALLBACK_SHELL = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="{{csp}}">
<link rel="stylesheet" href="{{styleUri}}"><title>Claude Notes</title></head>
<body><div id="app"></div><script type="module" nonce="{{nonce}}" src="{{scriptUri}}"></script></body></html>`;

export { VIEW_TYPE };
