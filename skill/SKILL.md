---
name: visual-notes
description: Use during planning, architecture, or comparison discussions instead of writing long prose explanations. Emits a compact diagram spec to .claude/notes.json which the "Claude Notes Panel" VS Code extension renders live as a hand-drawn whiteboard (rough.js) or a mermaid diagram. Trigger whenever you would otherwise write more than ~5 lines of explanatory prose about structure, flow, comparisons, or brainstorm options during a discussion (not for final code/file output).
---

# Visual Notes (Claude Notes Panel)

When a planning/discussion answer would otherwise be a wall of text describing
structure, flow, options, or trade-offs, write a JSON spec to
`.claude/notes.json` in the workspace root instead. The user's VS Code
"Claude Notes Panel" extension watches this file and renders it live in a side
panel with pan/zoom and fit-to-panel. Do NOT create this as a project file for
the user to keep - overwrite it each time, it is a scratch/display channel, not
a deliverable.

**Think of it as a whiteboard, not a box diagram.** Group things into labelled
frames, use shape and colour to carry meaning, and write in the margins with
annotations the way a person would while talking.

## When to use this
- Explaining an architecture, request flow, or data flow
- Comparing 2+ options / trade-offs during discussion
- Walking through what a bug actually does, with real record ids/values
- Sketching a rough plan or sequence of steps
- Brainstorming (freeform boxes, arrows and margin notes)

## When NOT to use this
- Writing actual code or files the user asked for
- Short answers (a sentence or two) - just answer normally
- Precise technical specs that need to be copy-pasted (e.g. exact commands)

## Choosing a style
- **sketchy** (default, preferred): the whiteboard. Auto-layout, frames,
  shapes, sticky notes, margin annotations, legend. Use for almost everything -
  it reads as thinking-in-progress, which is what a discussion answer is.
- **mermaid**: only when you specifically want a formal graph type mermaid does
  well and sketchy does not - sequence diagrams, state machines, ER, gantt,
  large auto-routed dependency graphs.

---

## Sketchy spec (the whiteboard)

**Do not hand-place coordinates.** Put nodes in frames and let the layout
engine size and place everything; boxes auto-size to their text, so labels can
be as long as they need and `\n` works. `x`/`y`/`w`/`h` are still honoured for
old specs but you should not write them.

```json
{
  "style": "sketchy",
  "title": "Why PM 122 grew to 5 rows",
  "layout": "columns",
  "frames": [
    { "id": "now", "title": "NOW - what the code does", "nodes": ["n1", "n2"] },
    { "id": "fix", "title": "FIX - one line per product", "nodes": ["f1"], "flow": "col" }
  ],
  "nodes": [
    { "id": "n1", "label": "3886 · budgeted 200", "sub": "the original budget line", "kind": "base", "badge": "start" },
    { "id": "n2", "label": "pick 50 splits the line", "kind": "problem", "shape": "note", "emphasis": true },
    { "id": "f1", "label": "reserve against the same line", "kind": "fix" }
  ],
  "edges": [
    { "from": "n1", "to": "n2", "label": "Get From Stock" },
    { "from": "n2", "to": "f1", "style": "dashed", "kind": "fix", "label": "the fix" }
  ],
  "annotations": [
    { "text": "this is the part\nthat confuses PMs", "at": "n2", "dx": 18, "kind": "problem", "arrowTo": "n2" }
  ],
  "legend": [
    { "kind": "problem", "label": "broken today" },
    { "kind": "fix", "label": "proposed" }
  ]
}
```

### Fields

**top level**
- `style`: `"sketchy"`
- `title`: shown in the panel toolbar
- `layout`: `"columns"` (frames flow left-to-right, wrapping) or `"rows"`
- `maxWidth`: board width before frames wrap into a new band (default 1500)
- `nodeWidth`: default node width (default 270)
- `frames`, `nodes`, `edges`, `annotations`, `legend`

**frames** (labelled regions - use them, they are what makes a board readable)
- `id`, `title`
- `nodes`: ids of the nodes inside (or set `frame: "<frameId>"` on the node)
- `flow`: `"col"` (default, nodes stack downward) or `"row"` (left to right)
- `nodeWidth`, `color`, `titleColor`

**nodes**
- `id`, `label` (multi-line via `\n`; wraps automatically)
- `sub`: smaller dimmed second line - ideal for the concrete value/id/evidence
- `kind`: `base` (blue, neutral) · `problem` (red) · `fix` (green) ·
  `data` (amber, real records/values) · `accent` (purple) · `note` (sticky) ·
  `muted` (grey, background context)
- `shape`: `rect` (default) · `round` · `pill` · `note` (sticky, folded corner) ·
  `ellipse` · `diamond` (decision) · `cyl` (store/table)
- `emphasis`: true - thicker stroke + bold text, for the one thing that matters
- `badge`: tiny corner chip, e.g. `"step 1"`, `"bug"`, `"line 3886"`
- `hatch`: true - hand-shaded fill, good for "not built yet"
- `color`, `fill`, `textColor`: override the palette when you need to

**edges**
- `from`, `to` (node ids), `label`
- `style`: `solid` (default) · `dashed` · `dotted`
- `kind`: colours the arrow by meaning; `emphasis`: thicker; `arrow: false` for a plain connector
- Arrows auto-pick facing sides and elbow around, so vertical and horizontal
  chains both look deliberate.

**annotations** (margin scribbles - this is what makes it feel like a whiteboard)
- `text` (supports `\n`), `size`, `kind`/`color`, `rotate`, `underline`
- `at`: node id to anchor beside, with `dx`/`dy` nudges; or absolute `x`/`y`
- `arrowTo`: node id - draws a wobbly dashed pointer to it
- `anchor`: `start` (default) · `middle` · `end`

**legend**: `[{ "kind": ..., "label": ... }]` - drawn under the board.

### Whiteboard habits worth keeping
- Put the concrete evidence in `sub` (`"rsv #59, approved"`, `"budg 200"`).
  Real ids are what make a sketch trustworthy.
- One `emphasis` node per board: the punchline.
- Use `problem` red for the thing that is actually broken and `fix` green for
  the proposal, then add a `legend` so the colours are not a guess.
- Annotate rather than lengthen labels. Short label, sharp margin note.
- Frames in reading order: what happens now -> why it hurts -> what to change.

---

## Odoo-ish views: `tables` and `screens`

For anything about a model, a list of records, or a form, **draw the view** -
do not describe it. `tables` and `screens` sit in frames exactly like nodes,
and edges/annotations can point at them by id.

### `tables` - a list view
```json
"tables": [{
  "id": "ml_now",
  "frame": "today",
  "title": "procurement.line  (PM 122)",
  "kind": "base",
  "columns": [
    { "label": "id" }, { "label": "product" },
    { "label": "budg", "align": "right" }, { "label": "from_stock" }
  ],
  "rows": [
    ["3886", "1-1375055-3", "90", "yes"],
    { "kind": "problem", "cells": ["3887", "6457567-4", "300", "no"] }
  ]
}]
```
A row is either a bare **array of cells**, or an object `{ kind, cells }` when
the whole record should be tinted:
```json
"rows": [
  ["3887", "6457567-4", "300", { "text": "no", "dim": true }],
  { "kind": "problem", "cells": ["3886", "1-1375055-3", "90", { "text": "yes", "bold": true }] }
]
```
Cell objects support `text`, `kind`, `bold`, `dim`. Row `kind` tints the whole
record and colours its text; a cell `kind` overrides it for one cell.

- `columns`: `{ label, align: "left"|"right", width }`
- `align: "right"` for quantities, always.

### `screens` - a form view
```json
"screens": [{
  "id": "pm_form",
  "frame": "today",
  "kind": "base",
  "width": 720,
  "breadcrumb": "Procurement Management / PM 122",
  "buttons": [{ "label": "Get From Stock", "primary": true }, "Create Material Delivery"],
  "statusbar": [{ "label": "Draft" }, { "label": "In Progress", "active": true }, { "label": "Done" }],
  "groups": [{
    "title": "Header",
    "columns": 2,
    "fields": [
      { "label": "Sale Order", "value": "SO/2026/00085" },
      { "label": "Customer", "value": "E-Bank", "kind": "data" }
    ]
  }],
  "table": { "id": "ml_lines", "columns": [], "rows": [] },
  "footer": "5 rows - was 2 before Get From Stock"
}]
```
- `buttons`: string or `{ label, kind, primary }` - `primary` fills the chip
- `statusbar`: string or `{ label, kind, active }` - the Odoo stage bar, right aligned
- `groups[].fields`: `{ label, value, kind, emphasis }`, drawn as label + dotted
  value like a real form; `columns` defaults to 2
- `table`: an embedded one2many list, same shape as a `tables` entry
- Screens auto-size; `width` is a minimum and grows to fit the table.

## Organising the board

- `frames` carry `row` and `col`. As soon as one frame has either, the whole
  board switches to a grid: column widths and row heights come from the widest
  and tallest frame in each. Use it to say "these two options sit side by side,
  under the evidence".
- `frame.flow: "row"` for a step-by-step strip, `"col"` (default) for a lane.
- `frame.items` may list nodes, tables and screens together, in draw order.
- Without row/col, frames flow left to right and wrap at `maxWidth`.

## Annotations: use `place`, never pixel offsets

```json
{ "text": "this is the confusing part", "at": "ml_now", "place": "below", "kind": "problem", "arrowTo": "g3" }
```
- `place`: `below` · `above` · `left` · `right` (default), relative to the
  anchor's real laid-out box
- `at`: any element id (node, table, screen); `atFrame`: a frame id
- `dx`/`dy` are fine tuning on top of `place` - they are not the mechanism
- `arrowTo`, `rotate`, `underline`, `size`, `width` as before

---

## Mermaid spec

```json
{
  "style": "mermaid",
  "title": "Approval sequence",
  "code": "sequenceDiagram\n  PM->>Stock: Get From Stock\n  Stock->>Admin: approval request\n  Admin-->>Stock: approved"
}
```

The panel renders mermaid at natural size and fits it to the panel, so wide
graphs stay readable. Prefer `flowchart TB` over `LR` for anything with more
than ~4 nodes per rank; `direction` inside a subgraph is unreliable, so build
the shape with the top-level direction instead.

## Workflow
1. Decide the spec (frames + nodes + edges + annotations, or mermaid code).
2. Write it to `.claude/notes.json` (overwrite, do not append).
3. In your chat reply keep prose SHORT - a sentence or two pointing at the
   panel, not a re-explanation of the diagram.
4. If the user has not opened the panel yet, tell them to run
   `Claude: Open Notes Panel` from the command palette (once per session).

## Panel controls (mention once, if useful)
Drag to pan, wheel to zoom, `Fit` / `1:1` buttons, double-click to re-fit.
Toolbar also has `Pen` (freehand draw), `Note` (sticky notes), `Questions`
(answer box for anything you asked), `Clear marks`, `Save` (persist this
board to the project's note library) and `Library` (browse saved boards).

---

## Live/incremental rendering

The panel re-renders on every write to `.claude/notes.json`, and now preserves
pan/zoom across re-renders of the *same* board (same `title`) - it only
re-fits the view the first time a board with a new title appears. This means
you can build a board up in front of the user instead of writing it once at
the end:

- Write an early version with just the frames and the first few nodes as soon
  as you know the shape of the answer, then keep overwriting the same file
  (same `title`) as you add nodes/edges/annotations while you keep talking.
- Do NOT change `title` between these incremental writes - that is what tells
  the panel "same board, don't re-fit" vs "new board, fit to view".
- This is for genuinely long/exploratory answers where the board grows over
  several steps. For a normal-sized board, one write at the end is still
  fine - don't add ceremony where it isn't needed.

## Asking questions on the board

Add a top-level `questions` array to have the panel show an inline answer box
instead of you asking in chat:

```json
{
  "style": "sketchy",
  "title": "Migration plan",
  "questions": [
    { "id": "q1", "text": "Keep the old table around after cutover, or drop it immediately?" }
  ],
  "frames": [...], "nodes": [...]
}
```

- `id` must be stable across rewrites of the same board (reuse it if you
  rewrite the board with the same open question) so the panel can tell
  "already answered" from "still pending".
- The user answers in the panel's `Questions` button/tray. There is
  **no live push back to you** - the answer is written to
  `.claude/notes_feedback.json` in the workspace root and just sits there
  until you are invoked again (a new message from the user, or a scheduled
  wakeup) and read the file.
- Because of that, don't silently wait: tell the user in your chat reply that
  you left a question on the board and to answer there (or in chat, either
  works), and if this is a long-running/background task, poll
  `.claude/notes_feedback.json` on a schedule rather than assuming you'll be
  notified.

## Reading what the user left on the board

`.claude/notes_feedback.json` accumulates everything the user has done in the
panel since it was last cleared:

```json
{
  "answers":  [{ "id": "a-...", "questionId": "q1", "question": "...", "text": "drop it", "at": "2026-09-02T..." }],
  "drawings": [{ "id": "d-...", "color": "#e8563b", "points": [[x,y], ...], "at": "..." }],
  "stickies": [{ "id": "s-...", "x": 420, "y": 180, "text": "this box is wrong", "at": "..." }]
}
```

- Check this file whenever you're picking work back up on a board you drew,
  or whenever the user says something like "see what I marked on the board".
- `answers`: match `questionId` back to the `questions` you asked.
- `stickies`: `text` is what matters; `x`/`y` are board-pixel coordinates from
  when the note was dropped - treat them as "roughly here", not exact, since
  a later re-layout of the board can shift things.
- `drawings`: raw pen-stroke points in the same board-pixel space as
  `stickies` - useful mainly as "the user circled/underlined something around
  here", not as precise geometry. If you can't tell what a stroke is pointing
  at, ask.
- This file only grows - nothing clears it automatically. Once you've
  incorporated the feedback (or the board is being replaced), tell the user
  they can hit `Clear marks` in the panel, or run
  `Claude: Clear Notes Panel Marks` from the command palette.

## Persisting a board (project note library)

`.claude/notes.json` is scratch - it gets overwritten on the next board and
is not meant to survive. If a board is worth keeping around (a plan the user
will want to reopen later, a decision record, a diagram you'll want to refer
back to in a future session), write a **second copy** into
`.claude/notes/<slug>.json` in the workspace root (create the directory if it
doesn't exist) - same JSON schema as `notes.json`, just saved rather than
scratch. Pick a filename from the title, e.g. `migration-plan.json`; if one
already exists for this exact board, overwrite it, otherwise use a new name
rather than clobbering an older unrelated save.

- The user can also do this themselves any time by clicking `Save` in the
  panel - you don't have to remember to save everything, just the boards
  that are clearly worth keeping.
- The extension also auto-saves for you: whenever you overwrite
  `notes.json` with a board whose `title` differs from the one already
  showing, the panel archives the outgoing board to `.claude/notes/` first.
  So a board only needs an explicit save while it's still being grown under
  the same title - the moment you move on to a new title, the old one is
  already safe.
- The panel's `Library` button lists every file in `.claude/notes/` (title +
  saved time) and can reopen any of them read-only in the panel, resume one
  as the live/editable board, or copy a short "continue from this note"
  mention to the clipboard for the user to paste into chat.
- To resume a past discussion yourself: read the relevant file directly from
  `.claude/notes/` (the user may reference one by title, or paste the
  mention text the panel copied for them, which names the file) - there is
  no other channel that tells you which one they mean.
- Don't proactively enumerate or read every file in `.claude/notes/` unless
  asked - treat it as a library the user browses, not something to summarize
  unprompted.
