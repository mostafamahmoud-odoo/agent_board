# Claude Notes Panel

Renders Claude's planning/discussion notes as live diagrams (mermaid) or
hand-drawn sketches (rough.js) in a VS Code side panel — instead of walls of
chat text or throwaway `.md` files you have to delete.

## How it works
- The extension opens a webview panel and watches `.claude/notes.json` in
  your workspace root.
- A Claude Code skill (`skill/SKILL.md`) teaches Claude to write a small
  diagram spec to that file during planning discussions instead of long prose.
- The panel re-renders automatically whenever the file changes. Nothing is
  saved as a "real" deliverable file you need to clean up — it's a scratch
  channel, like a whiteboard.
- Claude can write the board incrementally (same `title`, several writes) and
  the panel keeps whatever pan/zoom you've set instead of re-fitting on every
  update — so you can watch a long board build without it jumping around.
- The channel back to Claude is one-way and file-based, not a live socket:
  anything you do in the panel (answer a question, draw with the pen, drop a
  sticky note) is appended to `.claude/notes_feedback.json` in the workspace
  root. Claude only sees it the next time it's invoked — send it a message
  (or it polls on its own for a long-running task) for it to notice.

## Panel toolbar
- **Pen** — freehand draw on top of the board (e.g. circle the thing you mean).
- **Note** — click the board to drop a sticky note with typed text.
- **Questions** — shows up when Claude leaves a question on the board; answer
  inline and it's saved to `notes_feedback.json`.
- **Clear marks** — wipes your answers/drawings/stickies (not the board
  itself). Same as `Claude: Clear Notes Panel Marks` from the command palette.
- **Save** — persists the current board to `.claude/notes/<slug>.json`, a
  project-local library that survives past this scratch session. Same as
  `Claude: Save Current Note to Library`.
  Also happens automatically: whenever Claude replaces the live board with a
  differently-titled one, the outgoing board is auto-saved first so nothing
  is silently lost — you only need `Save` to archive a board Claude is still
  actively growing under the same title.
- **Library** — browse everything saved for this project. `View` opens a
  saved board read-only (live updates pause and surface as a "Live board
  updated" banner instead of yanking the view); `Resume editing` copies it
  back into the live `notes.json` so it becomes editable/growable again;
  `Copy mention` puts a ready-made "continue from this note" line on your
  clipboard to paste into chat with Claude.

## Notes are per-project
`.claude/notes.json` is scratch (overwritten on every board). Saved notes
live in `.claude/notes/` in the same project — one JSON file per saved board,
named from its title. Both directories are workspace-local, so each project
keeps its own independent note history; commit `.claude/notes/` if you want
it to travel with the repo, or gitignore it if it's just a personal scratch
library.

## Install (dev mode, no marketplace needed)
1. Open this folder (`claude-notes-ext/`) in VS Code.
2. Press `F5` (or Run > Start Debugging). This launches an "Extension
   Development Host" window with the extension active.
3. In that window, open your actual project folder.
4. Run command palette → `Claude: Open Notes Panel`.

## Install permanently (package it)
`vsce` needs Node 20+; on Node 18 build the `.vsix` by hand instead — it's
just a zip (see `scripts/build-vsix.sh`).

```bash
./scripts/build-vsix.sh
antigravity --install-extension claude-notes-panel-0.1.0.vsix   # or: code --install-extension ...
```

## Wire up the skill
Copy `skill/SKILL.md` to `~/.claude/skills/visual-notes/SKILL.md` (all
projects) or `.claude/skills/visual-notes/SKILL.md` (one project) so Claude
Code picks it up automatically during planning conversations.

## Commands
- `Claude: Open Notes Panel` — opens/reveals the panel
- `Claude: Clear Notes Panel` — clears current notes (and any marks left on them)
- `Claude: Clear Notes Panel Marks` — clears just your answers/drawings/stickies

## Notes / limitations
- mermaid and rough.js are vendored into `media/vendor/`, so the panel works
  offline and under the webview CSP.
- This is a first pass — good enough to actually use, not
  marketplace-polished. Expect to tweak sizing/positioning by hand for now
  (no auto-layout engine yet; you place nodes with x/y).
- Mermaid handles auto-layout for you (flowcharts, sequence diagrams) — lean
  on that style when you don't want to think about coordinates.
- If you want auto-layout for the sketchy style too, swapping in
  Excalidraw's engine instead of raw rough.js is the natural next step.
