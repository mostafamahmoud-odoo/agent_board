# Real-browser probes

jsdom is fine for wiring (ids, clicks, message plumbing) but it cannot model
pointer capture or run mermaid, so two things are checked in real Chrome:

    npm run probe

- **pen-probe.html** — drives the pen with real `PointerEvent`s and reports
  whether arming draws (it must not), whether hovering with the button up
  draws (it must not), whether one press-drag-release makes exactly one
  stroke, and whether the pen stays armed for the next one.
- **mermaid-probe.html** — loads the vendored UMD bundle the way the panel
  does and renders a flowchart. This is what caught `initialize is not a
  function`: the bundle is UMD, so `await import()` returns a namespace
  without the API and it has to be loaded as a classic script.

Both serve `dist/` over http because a module script will not load from
`file://`.
