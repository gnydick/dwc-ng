# Project: Duet Web Control Replacement

## Context

This repo is a ground-up replacement for Duet Web Control (DWC), the web UI
for Duet3D boards running RepRapFirmware (RRF). Target: standalone mode
first (board serves UI from SD card via RRF's embedded HTTP server), with
an architecture that allows a DSF/SBC WebSocket connector to be added later
with no rework above the connector abstraction.

## Rules

- Project rules live in `.claude/rules/`, one markdown file per group and one rule per
  bullet. The register index over them is `.claude/machinery/INDEX.md`, which is
  GENERATED and never edited by hand — run `/machinery:reindex`.
- Universal rules — the ones that would hold in any project — come from the `machinery`
  plugin and are loaded into every session automatically. They are deliberately not
  restated here; several sections below are retired to a pointer at one.
- Dictate a project rule by starting the prompt with `PRULE:` and a universal one with
  `URULE:`. The capture lands in `.claude/machinery/inbox.md` as PENDING. A bare `RULE:`
  captures nothing and asks which you meant.
- File a captured rule with `/machinery:rule-intake`. The commit gate — `.githooks/pre-commit`,
  which runs `.githooks/machinery/gate.mjs` on EVERY commit — fails while any inbox entry
  is PENDING, while the index disagrees with the staged rule files, or on a newly added
  citation that does not resolve.

## Hard constraints (these drive everything)

> SUPERSEDED (2026-09-02): see .claude/rules/hard-constraints.md § Hard constraints

## Reference source: read-only, never copy (HARD AND FAST RULE)

> SUPERSEDED (2026-09-02): see .claude/rules/reference-material.md § What counts as reference here for what counts as reference in this repo, and machinery plugin rules/reference-sources.md § Reference only for the ban on copying it

## Stack (already decided, do not relitigate)

> SUPERSEDED (2026-09-02): see .claude/rules/stack.md § Stack (already decided, do not relitigate)

## Architecture requirements

> SUPERSEDED (2026-09-02): see .claude/rules/architecture.md § Architecture requirements

## Solid-specific rules (I will be reviewing for these)

> SUPERSEDED (2026-09-02): see .claude/rules/solid.md § Solid-specific rules

## Dependency policy (security)

> SUPERSEDED (2026-09-02): see .claude/rules/dependencies.md § Dependency policy for this project's values, and machinery plugin rules/environment-and-platform.md § Dependencies for the policy itself

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

Ask me before deviating from any decision recorded here.

## Working rules (verification discipline)

> SUPERSEDED (2026-09-02): see machinery plugin rules/verification-and-evidence.md § The word you just wrote makes a check due. All six bullets are stated there; none is restated as a project rule

## Working rules (development environment)

> SUPERSEDED (2026-09-02): see .claude/rules/uat-and-mock.md § Proving a change against something that behaves like the machine, and § Completion claims in the same file

## Working rules (work topology)

> SUPERSEDED (2026-09-02): see machinery plugin rules/agent-topology.md § What gets dispatched, § How many at once and § Where an agent works, plus machinery plugin rules/worktree-discipline.md. The two bullets with project-specific residue are .claude/rules/uat-and-mock.md § The test agent class (this project's fourth agent kind) and § Proving a change against something that behaves like the machine (a mock runs from the worktree of the work it serves)
