# Agent Board

When an AI coding agent is planning, comparing options, or walking you through a bug, it
usually has to write a wall of text. This extension gives it a whiteboard
instead.

The agent writes a small JSON spec to `.agent/notes.json`; the panel watches
that file and renders it live — as an editable draw.io canvas, a hand-drawn
board, a precise diagram, or a mermaid graph. Nothing is left behind for you to
clean up: the file is scratch, overwritten on every board.

![the board](media/icon.png)

## Install

Install from the Marketplace, open a project where you use an AI coding agent, and run
**Agent Board: Open Panel** (`Ctrl+Alt+N` / `Cmd+Alt+N`).

Then teach your agent to use it. The board is just a JSON file, so any agent
that can write one can drive the panel — it only needs to be told how. For
Claude Code, copy `skill/SKILL.md` into its skills directory:

- `~/.claude/skills/visual-notes/SKILL.md` — every project, or
- `.claude/skills/visual-notes/SKILL.md` — this project only.

It is picked up automatically, and the agent will start drawing during
planning conversations instead of writing long prose. For another agent, point
it at `skill/SKILL.md` however that agent takes instructions — the file
documents the whole board format, including where to write it
(`.agent/notes.json`) and where your replies come back
(`.agent/notes_feedback.json`).

## What you get

**Four styles over one board.** The agent writes the board once; the toolbar
decides what draws it, with the same layout every time.

- **draw.io** (default) opens the board in an embedded editor, so you can move,
  restyle and reconnect anything on it — not just read it. It loads from the
  internet unless you point `agentBoard.drawioUrl` at a local copy.
- **sketchy** is the hand-drawn board, rendered in the panel itself. It reads as
  thinking-in-progress, and it is the one with the pen, sticky notes and the
  questions tray.
- **clean** is the same board with precise strokes, for pasting into a ticket
  or a design review.
- **mermaid** is there for the formal graph types (sequence, state, ER, gantt).

**Frames, tables and screens.** Boards are not just boxes and arrows: the agent
can draw a labelled region, a record list with a specific row tinted red, or a
form view — so "the bug is on line 3887" can be *shown* rather than described.

**You can answer back.** The agent can leave questions on the board; you answer in
the panel. You can also draw on it with the pen and drop sticky notes. Anything
you leave is captured to `.agent/notes_feedback.json`, and VS Code offers to
copy it in a form you can paste straight back to the agent.

**A per-project library.** Boards worth keeping are archived to
`.agent/notes/`. When the agent replaces the live board with a differently-titled
one, the outgoing board is saved first, so nothing is silently lost. Commit
that directory if you want the history to travel with the repo, or gitignore it
if it is personal scratch.

## Keyboard

The panel is fully keyboard-operable, and the board exposes a text description
to screen readers.

| Key | Action |
|---|---|
| `Ctrl+Alt+N` / `Cmd+Alt+N` | Open the panel |
| `Tab` / `Shift+Tab` | Move through the toolbar; inside the board, between elements |
| Arrow keys | Pan |
| `+` / `-` | Zoom in / out |
| `0` | Reset zoom to 100% |
| `F` | Fit the board to the panel |
| `P` | Pen mode |
| `N` | Drop a sticky note |
| `Escape` | Close a tray, or leave pen/note mode |
| `Ctrl+Enter` | Submit the answer you are typing |

**Agent Board: Copy Board as Text** puts the same description the screen
reader gets on your clipboard — useful for pasting a board into a ticket.

## Settings

| Setting | Default | |
|---|---|---|
| `agentBoard.defaultStyle` | `drawio` | Style for boards that do not declare one |
| `agentBoard.openOnStartup` | `true` | Open automatically when a board already exists |
| `agentBoard.notifyOnFeedback` | `true` | Tell you when a reply is captured |
| `agentBoard.feedback.maxEntries` | `500` | Bound on the feedback log |
| `agentBoard.library.maxEntries` | `200` | Bound on the board library |
| `agentBoard.reducedMotion` | `auto` | `auto` follows VS Code's `workbench.reduceMotion` |
| `agentBoard.drawioUrl` | *(empty)* | Where the draw.io editor is served from; empty uses the public host |
| `agentBoard.drawioSketch` | `true` | Use draw.io's hand-drawn rendering |

## Good to know

**The channel back is one-way.** Anything you leave in the panel sits in
`.agent/notes_feedback.json` until the agent is next invoked — there is no live
socket. The notification's **Copy for your agent** action is the fastest way to
hand it over; otherwise just tell the agent to check the board.

**Theming and contrast.** Every colour comes from your theme's own tokens, and
the palette is checked against WCAG AA for all seven semantic kinds across
dark, light and both high-contrast themes. Kinds are also distinguished by
stroke pattern, not only hue, so they stay readable in high contrast and for
colour-vision differences.

**It watches the first workspace folder.** In a multi-root workspace the status
bar names which one.

**Restricted workspaces.** In a workspace you have not trusted, the panel
renders read-only: it will not write to `.agent/`, save to the library, or run
mermaid.

## Developing

Requires **Node 22+** (`@vscode/vsce` 4 needs it).

```bash
npm install
npm run compile      # check-types + lint + esbuild (two bundles)
npm run test:unit    # fast, no DOM, no VS Code
npm test             # integration, drives a real VS Code
npm run package      # -> .vsix
./verify.sh          # everything above, with real exit codes
```

Press `F5` to launch an Extension Development Host.

The layout engine is a pure function — `layout(spec, measurer) → LayoutResult`
— with no DOM, no theme and no rough.js, so all four renderers (sketchy,
clean, draw.io, mermaid) and the accessibility description are drawn from one
geometry. Text measurement is
injected, which is what lets layout be tested with no DOM at all. (Do not
reach for jsdom here: it has no `getBBox`, and happy-dom returns zeros, which
silently produces a board where everything sits at the origin.)

## License

MIT © Moustafa Mahmoud
