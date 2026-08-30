# @dwc-ng/mock-duet

A zero-dependency mock of a Duet3D board's embedded HTTP server, speaking the
RRF `rr_` dialect (3.6.3 line). It lets the UI's `PollConnector` be developed
and tested without a physical board. Runs directly on Node ≥ 23 (native
TypeScript type stripping) — no build step, no runtime dependencies.

```sh
pnpm mock                                  # from the repo root (idle scenario)
pnpm --filter @dwc-ng/mock-duet start -- -s mid-print -p 8971
pnpm --filter @dwc-ng/mock-duet start -- --list   # list scenarios
pnpm --filter @dwc-ng/mock-duet test       # protocol test suite (node:test)
```

## Lifecycle: whoever stands a mock up owns tearing it down

`pnpm mock` runs in the foreground and stops with Ctrl-C. For anything you
want to leave running — a UAT stack, a scratch mock for a ticket — use the
control verbs, which start it detached and give you a way to find it again:

```sh
pnpm mock:start          # detached, from THIS worktree; waits for it to REGISTER
pnpm mock:status         # every tracked mock in every worktree, + orphans
pnpm mock:stop           # this worktree's; --all, --port <n>, --pid <n>
pnpm mock:restart        # stop this worktree's, start one on the same port
pnpm mock:reap           # stop EVERY live mock-duet, tracked or not
pnpm mock:reap --dry-run # ...or just show the table
```

`mock:start` reports success only once the child has written its PID file, so
a start that dies in argument parsing or loses the port race is reported as a
FAILURE with its log — never confirmed by curling the port, which on
2026-08-29 was answered by an unrelated orphan while the start had already
failed.

Every mock started through the CLI registers, at the MAIN checkout's root so
one command sees every worktree:

```
<project root>/target/run/mocks/<worktree>/<pid>      # file NAME = pid, CONTENT = port
<project root>/target/run/logs/<worktree>/<pid>.log   # detached start output
```

A clean exit removes the file; a hard kill cannot, so `mock:status`
distinguishes `running` from `stale pidfile (…)` and lists **untracked
orphans** — live mocks with no PID file, the only way a mock that predates
this mechanism is visible at all. Only `mock:reap` can stop those; `mock:stop`
never touches anything the registry does not know about.

Nothing is killed without three checks passing first: the PID's process must
be node running the mock's entry point, it must be the process actually
listening on the port the file records, and it must have started before that
file was written. Kills are confirmed by effect — process gone, port released
— never by an exit code. See `src/pidfile.ts`.

### Ports: two classes, and they never overlap

| Class | Ports | Who |
|---|---|---|
| **UAT stack** (reserved, exactly one at a time) | mock **8970** + vite **5173** | the stack Gabe drives, one bookmark, always the same numbers |
| **Ticket scratch** (derived, never scavenged) | **8000 + `<ticket>`** — GIT_170 → 8170 | an agent's own mock for the ticket it is working |

`mock:start` derives the ticket port from the worktree name, so nothing has to
remember it and a stray process names the ticket that owns it. The UAT slot
must be asked for explicitly (`pnpm mock:start --uat`); 8970 is reserved out
of the derived range so no ticket can take it. Vite's half is pinned with
`strictPort: true` — it silently increments otherwise, and on 2026-08-29 a UAT
landed on 5184 while everyone believed it was on 5173. The numbers live in
`src/ports.ts`, which `vite.config.ts` imports rather than repeating.

## What it implements

| Endpoint | Behaviour |
|---|---|
| `rr_connect` / `rr_disconnect` | Sessions with `sessionKey`, `err` 0/1/2 (ok / bad password / no free sessions), `apiLevel: 1` |
| `rr_model` | `f v n o d<n> a<offset>` flags, `seqs` key, live (`d99fn`) projection, array chunking with `next`, `move.axes` 9-element truncation, `#key` counts |
| `rr_gcode` + `rr_reply` | Mini G-code interpreter; every code bumps `seqs.reply`; per-session reply buffers that expire if not drained (RRF drops them ~1 s after completion) |
| `rr_upload` | CRC32 verification (`err 1` on mismatch), bumps `seqs.volChanges` |
| `rr_download` / `rr_delete` / `rr_move` / `rr_mkdir` | In-memory virtual SD seeded with a standard `0:/` layout (config.g, macros, two job files) |
| `rr_filelist` / `rr_files` | `first`/`next` pagination, `err` 1 (unmounted) / 2 (missing dir) |
| `rr_fileinfo` / `rr_thumbnail` | Canned job metadata; chunked base64 thumbnail delivery |

Auth mirrors the real board: every endpoint except `rr_connect` requires a
valid `X-Session-Key` header and answers **401** otherwise, which is the
trigger DWC uses to re-authenticate. Sessions expire after `sessionTimeout`
(8 s) without traffic. A firmware reset (`M999`) restarts `state.upTime` and
kills all sessions.

The G-code interpreter covers what an interactive UI exercises: `M104/M109`,
`M140/M190`, `M568`, `M106/M107`, `G0/G1`, `G28`, `T<n>`, `M114`, `M115`,
`M32`, `M24/M25`, `M0/M2`, `M112/M999`, `M550`. Everything else succeeds
silently with an empty reply, like most codes on a real board.

## Simulation model

The machine (a Duet 3 Mini 5+ driving a single-tool CoreXY) advances on a
250 ms tick: temperatures follow first-order lag toward their targets with a
little noise, thermostatic fans switch with their sensor, job progress /
layers / times-left derive from the fake job file's metadata.

**`seqs` semantics are the point of this package**: analog values
(temperatures, positions, progress) change every tick *without* bumping a
counter — they travel in the `f`-flag live projection. Only discrete events
bump a subtree's counter: heater faults, job start/end, tool changes, file
operations (`volChanges`), resets. This is what drives the UI's
poll → seqs → re-fetch → reconcile loop.

## Scenarios

| Name | What happens |
|---|---|
| `idle` | Powered on, nothing homed, ambient temps |
| `mid-print` | Benchy at ~37%, temps at target, progress advancing |
| `heater-fault` | Heats bed+hotend; hotend faults at t=15 s (`state: "fault"`, `seqs.heat` bump, `Error:` console message) |
| `disconnect` | Network outages (dropped connections, sessions killed) at t=20 s and t=90 s, 8 s each |

Scenarios are `{ init, events[] }` scripts against the `Machine` API
(`src/scenarios/`). Adding one is a ~10-line file.

## Failure injection

| CLI flag / option | Simulates |
|---|---|
| `--busy-every <n>` | Every nth `rr_model`/`rr_filelist`/`rr_files` request answers **503** (RRF out of output buffers — the client must retry) |
| `--chunk-size <n>` | Smaller `rr_model` array chunks / file-list pages → more `next` pagination |
| `--reply-expiry <ms>` | How quickly unread G-code replies vanish |
| `--password <pw>` | Require a password at `rr_connect` |
| `--no-auth` | Disable the session check (handy for `curl`) |

## Feeding it captured traffic

Pass `--snapshot <file>` to serve a captured object model instead of the
synthetic base. The bundled capture is a real 4-tool toolchanger
(7 axes X Y Z U V W C, 6 CAN boards):

```sh
pnpm --filter @dwc-ng/mock-duet start -- --snapshot captures/om-snapshot-2026-07-12.json
```

Accepted input: a full OM tree as returned by DSF's `GET /machine/model`
(SBC mode) or stitched from per-key `rr_model?key=<key>&flags=d99vno`
responses (standalone). The loader (`src/capture.ts`):

- replaces base subtrees per polled key, wholesale;
- drops root keys standalone RRF never serves (`sbc`, `plugins`, `messages`)
  — SBC captures contain them, real `rr_model` output does not;
- never takes `seqs` from a capture: it is standalone-only wire-protocol
  state (absent in SBC mode entirely), so the Machine synthesizes and bumps
  all counters itself.

Caveat: replacement is per whole subtree, so DSF-maintained *nested* fields
inside polled keys survive. The mock is a slight superset of a real
standalone board — don't treat field presence here as proof it exists on
standalone hardware.

Other ingestion points, still open for captures:

- **Live projection** — a capture of `rr_model?flags=d99fn` defines which
  fields belong in `liveModel()` (`src/model-query.ts`).
- **File metadata** — captures of `rr_fileinfo` responses drop into
  `VirtualSD.fileInfo` (`src/files.ts`).

## Persisting state across a restart (`--state`, opt-in)

By default the mock **forgets everything on exit**, and that default is
deliberate: a mock that forgets is a faithful model of a machine that can be
wiped, and one that silently remembers can hide a config-LOADING bug — the UI's
own `localStorage` cache already masks that class of defect. With no flag,
nothing is written to disk anywhere.

```
pnpm --filter @dwc-ng/mock-duet start -- --state ./machine.state.json
```

Given a path, the mock writes ONE snapshot holding the whole virtual SD card
(config, shaping results, macros, uploads, the `fileInfo`/thumbnail indexes)
**and** the machine state a session established (homed axes, selected tool),
and restores it at startup. Simulated values — temperatures, positions, job
progress — are not persisted: they are computed every tick, not set by a person.

Durability: every write goes to a temp file beside the destination, is fsynced,
and is then renamed over it, so a `Stop-Process -Force` at any instant leaves
either the previous complete file or the new complete file — never a prefix.
The file also carries a CRC-32 of its payload; a file damaged by anything else
is reported unreadable at startup and the mock starts clean, rather than
restoring half a machine. This is `src/persist.ts`, the only module in the
package that writes to disk.

A state file can be committed and replayed: `test/fixtures/state-v2-toolchanger.json`
is a real pre-v3 machine, produced by driving a mock over HTTP and killing it,
and `packages/ui/test/config-migrate-from-mock-state.test.ts` puts a current
build in front of it to see what config migration actually does — which is why
this exists at all. Copy a committed fixture before pointing a mock at it: a
mock rewrites its own state file.

Not to be confused with `--config-version`, which seeds a *synthetic* v1/v2/v3
`dwc-ng-config.json`. That stays as it is; this makes a *real* old machine
reproducible.

## Protocol sources (do not code from memory)

- `reference/connectors/src/PollConnector.ts` — the request patterns the real client makes
- `reference/rrf-m409-object-model.md` — `rr_model` flag semantics
- `.claude/skills/duet-http-api/` — endpoint map + OpenAPI specs
- `reference/objectmodel/src/` — field names/shapes for the snapshot
