import * as fs from 'node:fs';
import * as vscode from 'vscode';

import type { BoardSpec } from '../shared/types.js';
import { describeIssues, parseBoard } from '../shared/schema.js';
import type { NotesPanel } from './panel.js';
import { readWhenSettled, writeJsonAtomic } from './fsAtomic.js';
import { listLibrary, loadSpec, saveSpec } from './library.js';
import { isWritable, notesPath, watchedFolderName } from './workspace.js';

/**
 * Owns the live board: read -> validate -> dispatch, plus the single
 * authoritative copy of the "viewing a saved board" flag.
 *
 * The prototype kept that flag on both sides and they could diverge —
 * `backToLive` cleared the host's copy and called readAndRender, which
 * returned early if notes.json was missing, leaving the webview's banner up
 * forever (protocol invariant I1).
 */
export class BoardStore {
  private generation = 0;
  private lastLiveSpec: BoardSpec | null = null;
  private viewingSaved: string | null = null;
  private pending = false;

  constructor(private readonly panel: NotesPanel) {}

  get isViewingSaved(): boolean {
    return this.viewingSaved !== null;
  }

  get liveSpec(): BoardSpec | null {
    return this.lastLiveSpec;
  }

  /** A watcher event. Coalesces bursts and waits for the write to settle. */
  async onFileChanged(): Promise<void> {
    if (this.viewingSaved) {
      this.panel.post({ type: 'liveUpdated' });
      return;
    }
    if (this.pending) return; // a settle-read is already in flight; it will see the latest
    this.pending = true;
    try {
      await this.render();
    } finally {
      this.pending = false;
    }
  }

  async render(): Promise<void> {
    const p = notesPath();
    if (!p || !fs.existsSync(p)) return;

    const text = await readWhenSettled(p);
    if (text == null) return;
    if (!text.trim()) return;

    const { spec, result } = parseBoard(text);
    if (!spec) {
      this.panel.post({
        type: 'error',
        message: describeIssues(result.fatal),
        detail: result.fatal
      });
      return;
    }

    // A title change means the previous board is being replaced outright, not
    // grown incrementally — archive it before it is gone.
    if (this.lastLiveSpec && this.lastLiveSpec.title && spec.title !== this.lastLiveSpec.title) {
      if (saveSpec(this.lastLiveSpec)) this.panel.post({ type: 'library', items: listLibrary() });
    }
    this.lastLiveSpec = spec;
    this.panel.post({ type: 'render', spec, generation: ++this.generation, watchedFolder: watchedFolderName() });
  }

  showSaved(file: string): boolean {
    const spec = loadSpec(file);
    if (!spec) return false;
    this.viewingSaved = file;
    this.panel.post({ type: 'render', spec, generation: ++this.generation, viewingSaved: file, watchedFolder: watchedFolderName() });
    return true;
  }

  async backToLive(): Promise<void> {
    this.viewingSaved = null;
    const p = notesPath();
    if (!p || !fs.existsSync(p) || !fs.readFileSync(p, 'utf8').trim()) {
      // Nothing live to show. Say so rather than leaving the banner up
      // forever, which is what the prototype did.
      this.panel.post({ type: 'clear' });
      return;
    }
    await this.render();
  }

  /** Copies a saved board over the live one so it becomes editable again. */
  async resume(file: string): Promise<boolean> {
    if (!isWritable()) return false;
    const spec = loadSpec(file);
    const p = notesPath();
    if (!spec || !p) return false;
    writeJsonAtomic(p, spec);
    this.viewingSaved = null;
    this.lastLiveSpec = null;
    await this.render();
    return true;
  }

  saveCurrent(): string | undefined {
    const p = notesPath();
    if (!p || !fs.existsSync(p)) return undefined;
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (!raw) return undefined;
    const { spec } = parseBoard(raw);
    if (!spec) return undefined;
    return saveSpec(spec);
  }

  clear(): void {
    const p = notesPath();
    if (p && isWritable()) {
      try {
        fs.writeFileSync(p, '');
      } catch {
        void vscode.window.showWarningMessage('Agent Board: could not clear .agent/notes.json.');
      }
    }
    this.viewingSaved = null;
    this.lastLiveSpec = null;
    this.panel.post({ type: 'clear' });
  }
}
