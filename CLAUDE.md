# Project: Duet Web Control Replacement

## Context

This repo is a ground-up replacement for Duet Web Control (DWC), the web UI
for Duet3D boards running RepRapFirmware (RRF). Target: standalone mode
first (board serves UI from SD card via RRF's embedded HTTP server), with
an architecture that allows a DSF/SBC WebSocket connector to be added later
with no rework above the connector abstraction.

## Hard constraints (these drive everything)

- RRF's embedded HTTP server is weak: very few concurrent connections,
  small output buffers, requests are expensive. Minimize request count and
  total payload. **Standalone only:** emit pre-gzipped assets (RRF serves
  .gz transparently). **Never gzip for DSF/SBC** — verified 2026-07-24 on
  a Duet 3 + SBC: DuetWebServer (Kestrel) neither compresses on the fly
  nor serves .gz transparently, so a .gz deploy 404s every asset. The
  packager derives compression from the SERVING STACK (which server will
  answer the browser), not from the transport that wrote the files —
  re-seated 2026-07-31 so one protocol, e.g. FTP, can serve either mode;
  see docs/superpowers/specs/2026-07-24-deployment-packaging-design.md.
- No heavy component libraries. Hand-rolled CSS. (The old "under ~300KB
  gzipped" bundle target is **non-binding** — Gabe, 2026-07-24: "that size
  is not a problem at all". Measured: eager 96.9 KB gz, total 665 KB gz,
  Babylon 232 KB of it and lazy.)
- The UI is a live mirror of RRF's object model, updated via polling:
  lightweight status polls, watch `seqs` counters, re-fetch changed
  subtrees via chunked `rr_model` queries (depth/frequency flags, array
  offsets). Merge = wholesale subtree replacement.
- nothing should be able to break by construction

## Reference source: read-only, never copy (HARD AND FAST RULE)

- ALL vendored and example third-party source we read — everything under
  reference/ (DWC, @duet3d/*, the M409 docs), any installed dep we open to
  study (e.g. @sindarius/gcodeviewer, Babylon examples), and any code seen
  on a board, in a repo, or on the web — is REFERENCE ONLY. It exists to
  help us understand HOW a problem was solved and WHAT edge cases exist.
- You may NEVER copy, port, transcribe, translate, or line-by-line
  paraphrase vendor/example code into this repo. Every implementation here
  must be our own novel work: take the understanding, then write it from
  scratch to fit our architecture (Solid store + reconcile, connector
  abstraction, lean plain-data types, hand-rolled CSS, our conventions).
- Citing reference by file/line to explain a decision is encouraged;
  lifting its code is forbidden. This is a standing project rule, not
  license-driven caution to be waived — it holds regardless of the vendor's
  license. If a solution seems to require copying, STOP and ask.

## Stack (already decided, do not relitigate)

- SolidJS + TypeScript + Vite, pnpm workspaces
- packages/ui — the app. packages/mock-duet — mock RRF server (to be built)
- Solid store + reconcile() for object model merging
- uPlot for temperature charts, CodeMirror 6 (lazy-loaded) for config
  editing, Three.js (lazy-loaded) only if/when gcode/heightmap 3D happens

## Architecture requirements

- Connector abstraction from day one: interface with connect, subscribe,
  sendCode, upload, list, etc. Implement PollConnector (rr_ API) only.
  DSF connector is a future bolt-on.
- PollConnector must handle: rr_connect sessions/auth, seqs-driven
  invalidation, chunked rr_model, rr_gcode + rr_reply shared-buffer
  draining, rr_upload with CRC32 verification, rr_filelist pagination
  ("next" param), retry-on-503 (firmware busy), idle keepalive.
- ✅ Evaluated (2026-07-12): @duet3d/objectmodel is NOT Vue-coupled (zero
  runtime deps) but is class-instance based with in-place mutating update()
  — incompatible with Solid store proxies + reconcile(). Decision: types
  reference only (vendored copy = shape authority, cited by file/line);
  UI defines lean plain-data interfaces for rendered subtrees. Not a
  runtime dependency.
- Vendor the official DWC source into reference/dwc/ as read-only
  reference (mark excluded from builds). Its PollConnector encodes years
  of edge cases (M409 retry logic, upload verification, firmware version
  workarounds). Read it before reimplementing any rr_ interaction.
- Scaling features should work universally. Interface cards should
  not need resizing or layout updated.
- Unique desktop and mobile profiles for both portrait and landscape should be
  saved, so 4 layouts per machine
- Mobile version of UI should be mobile first, not copying desktop
  paradigms by default. Desktop paradigms are not rules out.

## Solid-specific rules (I will be reviewing for these)

- Never destructure props (kills reactivity). Use props.x or splitProps.
- Use <Show>/<For>/<Switch>, not early returns or .map in JSX.
- Signals/stores accessed inside tracking scopes only.

## Dependency policy (security)

- pnpm 10+. Lifecycle scripts blocked by default; allowlist only esbuild
  in onlyBuiltDependencies. minimumReleaseAge: 4320 in pnpm-workspace.yaml.
- NEVER add a dependency without asking me first. Prefer zero-dep or
  low-dep packages. Frozen lockfile installs only.

## First tasks (in order, confirm plan before executing)

1. ✅ **Done (2026-07-10).** Restructure the Vite scaffold into the pnpm
   workspace layout above. Add pnpm-workspace.yaml with the security settings.
   (packages/ui = @dwc-ng/ui, converted Preact→SolidJS; packages/mock-duet
   placeholder; packages/* glob, onlyBuiltDependencies:[esbuild],
   minimumReleaseAge:4320. Verified: build + dev server green.)
2. ✅ **Done (2026-07-10).** Write .claude/skills/ skills: duet-http-api (rr_
   endpoint reference), rrf-object-model (OM tree, seqs semantics, volatile vs
   static subtrees), solid-patterns (the rules above + conventions). Sourcing
   went beyond the original wiki/DWC-from-memory plan: vendored the real source
   into reference/ (@duet3d/objectmodel + @duet3d/connectors incl. the actual
   PollConnector, DuetWebControl v3.6.3, and a verbatim M409 doc snapshot);
   skills cite it with file/line pointers.
3. ✅ **Scaffold done (2026-07-12); awaiting captured traffic.**
   packages/mock-duet: zero-dependency Node HTTP server speaking the rr_
   dialect (sessions/auth, rr_model flags + chunking + seqs, gcode/reply,
   upload CRC32, filelist pagination, 503 injection) with scenario scripts
   (idle, mid-print, heater-fault, disconnect) and a 34-test node:test
   suite. Runs via Node's native TS type stripping (Node ≥ 23; scripts:
   `pnpm mock`, `pnpm test`). Captured-model ingestion added 2026-07-12:
   `--snapshot <file>` serves a real OM capture (per-key replacement, drops
   non-standalone keys sbc/plugins/messages, synthesizes seqs — SBC captures
   have none). Bundled capture: Gabe's 4-tool/7-axis toolchanger via DSF
   GET /machine/model (packages/mock-duet/captures/). 39 tests green.
   Optional remaining: rr_fileinfo + live-projection (flags=d99fn) captures.
4. ✅ **Done (2026-07-12).** Connector interface (src/connector/types.ts,
   transport-agnostic) + PollConnector (sessions, d99fn live poll, seqs
   diff → chunked d99vno refetch incl. the reportedAxes/move.axes edge
   case, reply drain, 503/401 recovery ladder, outage reconnect) + Solid
   OM store (reconcile per key + deep-merge live patches, lean types,
   OM-store vs UI-config boundary) + minimal Machine status page
   (preflight strip, 7-axis DRO, tools/heaters incl. bed-no-standby,
   console) — verified live in Chrome against mock-duet running the
   toolchanger snapshot (M32 print: temps/positions/progress streaming).
   16 ui tests + 40 mock tests green. Bundle: ~46 KB gz incl. Rajdhani
   600/700 latin woff2 (font shipping approved 2026-07-12).
5. ✅ **Done (2026-07-12).** App shell + layout-config milestone (agreed in
   session, follows task 4): hand-rolled hash router (decision: hash mode
   forced by embedded server; @solidjs/router declined for now), rail nav
   (Machine · Jobs · Macros · System · Settings; Jobs/Macros/System are
   stubs), console drawer on every view, floating camera tile, e-stop.
   Config store: user overlay on immutable code defaults, reset = drop
   overlay, snapshot-on-save history (cap 10) with revert, persisted to
   0:/sys/dwc-ng-config.json via rr_upload/download + localStorage cache.
   First consumers: axis role labels, tool dock sensors (Settings view
   edits them; Machine view renders them). Verified in Chrome: edit →
   save → hard reload → config restored from SD; dock semantics correct
   (printing T0 reads "away", docked T1 "docked"). 25 ui + 39 mock tests.
6. ✅ **Established constraint.** Pinned to the 3.6.3 line in the Duet3D
   repository ecosystem. (Exact refs in reference/README.md: @duet3d/objectmodel
   3.6.3, @duet3d/connectors 3.6.0 — its 3.6.x release — DuetWebControl v3.6.3.)

Put this file's contents (condensed) into CLAUDE.md as project memory.
Ask me before deviating from any decision recorded here.