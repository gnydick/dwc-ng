# Vendored reference source (read-only)

This directory contains **third-party source copied in for reference only**.
It is not our code, is not edited, and is **excluded from builds** (see
"Build exclusion" below). Per CLAUDE.md, read the relevant source here before
reimplementing any `rr_` interaction or object-model handling — it encodes
years of firmware edge cases.

**Do not edit these files.** To update, re-download at a new pinned ref and
replace the directory wholesale, then update the table below.

## Provenance

Pinned to the **3.6.3 firmware line**. The two extracted npm packages
(`objectmodel`, `connectors`) are versioned by branch, not tag, so the exact
commit SHA is recorded for reproducibility.

| Dir | Upstream repo | Ref | Commit / tag | Pkg version | Role |
|---|---|---|---|---|---|
| `objectmodel/` | [Duet3D/ObjectModel](https://github.com/Duet3D/ObjectModel) | branch `v3.6-dev` | `65b7e87` | `@duet3d/objectmodel` 3.6.3 | **Typed OM classes (TS).** Authoritative shape of the object model; the package CLAUDE.md wants to evaluate for reuse. |
| `connectors/` | [Duet3D/Connectors](https://github.com/Duet3D/Connectors) | branch `v3.6-dev` | `777343d` | `@duet3d/connectors` 3.6.0 | **The real `PollConnector`.** `src/PollConnector.ts` is the authoritative `rr_` poll loop, seqs handling, chunked `rr_model`, upload CRC, and 503 retry logic. |
| `dwc/` | [Duet3D/DuetWebControl](https://github.com/Duet3D/DuetWebControl) | tag `v3.6.3` | `dba59c3` | 3.6.3 | Official DWC Vue app. UI/UX reference. Note: the `rr_` connector logic was extracted to `connectors/` — it is **not** in this repo anymore. |

Additionally, a documentation snapshot (not source code):

| File | Upstream | Retrieved | Role |
|---|---|---|---|
| `rrf-m409-object-model.md` | [docs.duet3d.com Gcodes `#m409`](https://docs.duet3d.com/User_manual/Reference/Gcodes) | 2026-07-10 | Verbatim M409 section — the authoritative `rr_model` **flag-letter** semantics (`f v n o d a p`) and array-chunking (`a<n>` / `next`) rules, which are not in the connector source. |
| `duet-gcode.md` | [docs.duet3d.com Gcodes](https://docs.duet3d.com/User_manual/Reference/Gcodes) | 2026-07-22 | Full G/M/T-code dictionary — one `## <CODE>: <title>` heading per command, with parameters, examples and notes. **Lookup/verification** reference for what a code does and its parameters. Scraped and hand-cleaned (`[¶](#…)` permalink cruft removed), so trust the facts over the formatting. See the `duet-gcode` skill. |

Downloaded 2026-07-10.

### Note on versions

There is no 3.6.3 release of `@duet3d/connectors`; its 3.6.x line is
**3.6.0** (npm `latest`), which is what the `v3.6-dev` branch carries.
`@duet3d/objectmodel` is exactly 3.6.3. Both are the current 3.6 releases.

## Build exclusion

These files must never be compiled, bundled, or linted:

- **TypeScript:** `reference` is listed in `tsconfig.app.json` → `exclude`,
  and the compile scope is `include: ["src"]` regardless, so `tsc -b` never
  sees it.
- **Vite:** only reaches modules imported from the app entry; nothing under
  `src/` imports from `reference/`, so it is never bundled.
- **⚠️ pnpm workspace (future):** when the repo is restructured into the
  `packages/*` workspace (CLAUDE.md Task #1), the `pnpm-workspace.yaml`
  `packages:` glob **must not** match `reference/**` — otherwise pnpm will try
  to adopt these vendored `package.json`s as workspace packages. Use
  `packages/*` (not `**`), or add `!reference/**`.

## Where to start reading

- `rr_` HTTP mechanics → `connectors/src/PollConnector.ts` (see the
  `duet-http-api` and `rrf-object-model` skills for annotated line pointers).
- OM tree shape → `objectmodel/src/` (one file/dir per top-level key).
- `rr_model`/M409 flag letters & array chunking → `rrf-m409-object-model.md`.
- What a specific G/M/T-code does & its parameters → `duet-gcode.md` (grep
  `^## <CODE>:`; see the `duet-gcode` skill). Reference for understanding a
  code — the **form we emit** is still `packages/ui/src/control/commands.ts`,
  verified against `dwc/` and the real macros, not copied from here.
