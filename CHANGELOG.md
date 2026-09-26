# Changelog

All notable changes to Claude Notes Panel.

The Marketplace supports only `major.minor.patch` — semver pre-release tags are
not valid. Following the documented convention, **even** minor versions are
releases and **odd** minor versions are pre-releases.

## [0.6.1] — unreleased

### Fixed

- **The pen did not draw.** A stroke began on mouse-down and then died: the
  drawing surface only listened over the area the board occupied, and the
  request to keep following the mouse was being refused silently. Drawing now
  works anywhere in the panel, including strokes that start beside the board
  or end outside the window.

## [0.6.0] — unreleased

### Added

- **The board is objects, not a picture.** Drag any node, table, form or pen
  stroke to reposition it. Claude still decides the layout; your move is
  remembered as an offset against that element, so it survives Claude
  rewriting the board — and connectors, margin notes and the board's extent
  all follow what you moved. Arrow keys nudge a focused element.

### Fixed

- **Mermaid diagrams failed with "initialize is not a function".** The
  vendored bundle is UMD and was being loaded as an ES module, which returns
  a namespace without the API.

## [0.5.0] — unreleased

### Changed

- **The toolbar is now a floating pill of icon tools** over the board, with a
  separate view pill on the right — matching Claude's canvas rather than a
  full-width bar clamped to the top. Select, Pen and Sticky note are tools you
  pick; the board title, library and style live in menus.

### Fixed

- **The pen stayed armed after you finished a stroke**, so the next click
  anywhere started drawing again. It returns to Select when the stroke ends.
- **A sticky note could be written exactly once and never corrected** — saving
  it made it permanently read-only, and restored notes were read-only from the
  start. Notes are now editable, and editing one updates it instead of leaving
  a second copy behind.
- **Notes could not be moved.** They now have a drag handle, which also works
  with the arrow keys, and a delete button.
- A hidden toolbar button was not actually hidden, so Questions appeared on
  boards that had none.
- Light and high-contrast themes fell back to dark colours for any token the
  theme left undefined, which put a dark toolbar on a white board.

## [0.4.0] — unreleased

The first release built as a real extension rather than a prototype: TypeScript,
bundled, tested, and installable from the Marketplace.

### Added

- **A third render style.** `clean` draws the same board with precise strokes
  instead of hand-drawn wobble — for boards you paste into a ticket or a design
  review. Switchable from the toolbar; the board file is not rewritten. Layout
  is identical across styles.
- **Full keyboard operation.** Arrow keys pan, `+`/`-`/`0`/`F` zoom and fit,
  `Tab` moves between board elements, `P` and `N` reach pen and sticky notes,
  `Escape` leaves a mode or closes a tray.
- **Screen-reader support.** The board exposes a structured text description
  generated from the layout, so reading order matches visual order. Also
  available as **Copy Board as Text**. Mode changes and confirmations are
  announced through a live region.
- **A reply handoff.** When you answer a question, draw, or drop a note, VS Code
  says so and offers to copy your replies in a form you can paste straight to
  Claude. Consumed replies are not offered twice.
- **Settings** for default style, startup behaviour, notifications, log and
  library bounds, and reduced motion.
- **Commands**: Browse Board Library, Change Render Style, Fit, Reset Zoom,
  Copy Board as Text, Copy Pending Replies.
- Published JSON schemas for the board and feedback formats.

### Changed

- **Command titles** now use the `Claude Notes:` prefix instead of `Claude:`,
  which claimed a namespace this extension does not own and collided with
  Claude Code's own palette entries. Command **ids** are unchanged.
- **Activation** is now `workspaceContains:.claude/notes.json` rather than
  `onStartupFinished`, which fired in every window regardless.
- **Mermaid is loaded on demand.** It was fetched synchronously on every panel
  open — 3.3 MB, before anything else could run — even though most boards never
  use it.
- The library saves under a title-derived name, so repeated saves of one board
  overwrite instead of leaving one file per save.
- Colour now comes entirely from your theme's tokens. Kinds are distinguished
  by stroke pattern as well as hue, so they remain readable in high contrast and
  with colour-vision differences.

### Fixed

- **A crafted board filename could read or overwrite files outside the
  workspace.** Filenames coming from the panel were joined into a path with no
  containment check, and one code path copied the result over the live board.
  Every filename is now validated and resolved inside the library directory.
- **A corrupt feedback log destroyed every saved reply.** A read failure
  returned an empty log, which the next write then persisted over the real one.
  The file is now left untouched and the problem reported.
- **Annotations could be drawn outside the visible board.** Their position was
  computed twice by two copies of the same logic that had drifted apart. It is
  computed once.
- **A long legend overflowed the board.** Its width was measured and then
  discarded.
- **Board updates could be lost while the panel was hidden.** Messages are now
  queued and delivered when it becomes visible again.
- **Two updates arriving together could leave a stale board on screen.**
  Superseded renders are dropped.
- **A board saved mid-write showed an error.** The panel now waits for the write
  to finish.
- **A malformed board showed a raw error or a blank panel.** Problems are now
  reported by field, and a board with a bad reference still draws the rest of
  itself.
- Inserting one connector no longer changes how every later connector is drawn.
- Adding a connector to a missing element, or an element to a missing group, now
  reports the specific problem instead of failing silently.
- Theme changes are applied live, including to mermaid diagrams, which
  previously kept whatever theme was active when the panel first opened.
- Pen strokes are simplified before being stored; the log and the library are
  both bounded.
- All writes are atomic, so a reader never sees a half-written file.

### Security

- The panel runs under a strict content-security policy with a per-load nonce
  and no inline script or style.
- Mermaid runs at its strictest security level, and its output is inserted as
  parsed nodes rather than raw markup.

## [0.2.0]

- Auto-layout for the hand-drawn style: frames, tables, screens, annotations.
- Board library with auto-archive.
- Questions, pen and sticky notes.

## [0.1.0]

- First version: renders a board spec as mermaid or rough.js in a side panel.
