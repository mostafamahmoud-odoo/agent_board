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

- **real-mouse.mjs** — the important one. It drives the panel through the
  DevTools protocol (`Input.dispatchMouseEvent`), so events go through the
  browser's real hit-testing and pointer capture.

  This exists because the synthetic-event probe passed while the pen was
  visibly broken: it dispatched events at an element it chose itself, proving
  the handlers worked *if you could reach them* — not that a real press
  reached them. The real-mouse run showed `down:1, move:1, up:0` and
  `captured:false`: `setPointerCapture` on the SVG root had silently failed,
  and event delivery was bounded by the overlay's own box.

  Its coordinates are derived from the live viewport. Hardcoded ones put a
  test point below the window and reported a bad test as a product bug.

All of them serve `dist/` over http because a module script will not load from
`file://`, and the static server runs in its own process — `execSync` blocks
Node's event loop, so an in-process server can never answer the request Chrome
is waiting on.
