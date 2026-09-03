---
status: 🟢
---
# Architecture requirements

Moved 2026-09-02 from CLAUDE.md § Architecture requirements; history stays there. The
✅-marked bullets are standing decisions, not closed to-do items: they record what was
decided and must keep holding.

## Architecture requirements

- Connector abstraction from day one: an interface with connect, subscribe, sendCode,
  upload, list, and so on. Implement `PollConnector` (the `rr_` API) only. A DSF connector
  is a future bolt-on, addable with no rework above the connector abstraction.
- `PollConnector` must handle: `rr_connect` sessions and auth, seqs-driven invalidation,
  chunked `rr_model`, `rr_gcode` + `rr_reply` shared-buffer draining, `rr_upload` with
  CRC32 verification, `rr_filelist` pagination (the "next" param), retry-on-503 (firmware
  busy), and idle keepalive.
- ✅ Evaluated (2026-07-12): `@duet3d/objectmodel` is NOT Vue-coupled (zero runtime deps)
  but is class-instance based with an in-place mutating `update()` — incompatible with
  Solid store proxies + `reconcile()`. Decision: types are reference only (the vendored
  copy is the shape authority, cited by file/line); the UI defines lean plain-data
  interfaces for rendered subtrees. Not a runtime dependency.
- The official DWC source is vendored into `reference/dwc/` as read-only reference, marked
  excluded from builds. Its `PollConnector` encodes years of edge cases (M409 retry logic,
  upload verification, firmware version workarounds). Read it before reimplementing any
  `rr_` interaction.
- Scaling features work universally: interface cards never need resizing or their layout
  updated. ✅ Met (2026-08-21) by one global unit `--u` (`shell/scale.ts`, `data-scale` on
  `<html>`), every layout-space length as `calc(n * var(--u))`, and zero-layout
  decorations (borders and hairlines as inset box-shadow, never `border:`) — enforced by a
  test-suite-failing px lint in `test/unit-lengths.test.ts` (run by `pnpm test`, not
  `pnpm build`) and a Card Lab scale sweep asserting equal cell floors at 0.75 and 1.5 for
  every card. See docs/superpowers/specs/2026-08-21-global-unit-scaling-design.md.
- Unique desktop and mobile profiles are saved for both portrait and landscape, so four
  layouts per machine.
- The mobile UI is mobile first, not a copy of desktop paradigms by default. Desktop
  paradigms are not ruled out.
