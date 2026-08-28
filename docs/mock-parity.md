# mock-duet vs a real Duet board — the parity list

**What this is.** An enumeration of where `packages/mock-duet` and a real
Duet 3 running RRF 3.6.3 differ, so the remaining gap is *visible* rather than
rediscovered one feature at a time. GIT_92 requirement 5.

**Why it exists at all.** The mock is not a convenience. It is the thing that
makes a wrong UI observable before a change reaches hardware, and every rule in
`CLAUDE.md` § "Working rules (development environment)" leans on it. Two drifts
were found the expensive way: the machine-identity campaign keyed everything off
`boards[].uniqueId` against a mock serving no `boards` at all, and #102 found
`G28` hardcoded to XYZ on a machine with seven axes. Both were found by the
owner failing to use the mock, not by any review. A line in this file would have
caught either.

**A mock that is EASIER than the board is worse than no mock**, because it turns
a UAT pass into evidence of nothing. So "deliberately absent" is a first-class
entry here: a state the mock refuses to make easy is information, and writing it
down is what stops the next session from "fixing" it and removing a failure mode.

## When to update this file

The same trigger as mock parity itself (`CLAUDE.md` § "The mock moves with every
iteration"): **a change to what the UI reads from or writes to the board — a new
object-model key, a new file path, a config version bump, a new endpoint, a new
G-code the UI emits — updates the mock AND this list in the SAME change.** Those
are one rule, not two.

If a gap is found and NOT closed, it belongs here as a row before the task ends.
An unrecorded gap is the only kind that costs anything.

---

## 1. G-code execution — the largest gap, and the one that bites

The mock executes **39** codes. An unhandled code is **not** an error: it returns
an empty reply, so it looks exactly like success and changes nothing
(`src/gcode.ts`, the `default:` arm). That is the shape of #102, and it is why
this section leads the file.

**Executed** (`src/gcode.ts`): `G0 G1 G28 G90 G91 M0 M2 M24 M25 M32 M82 M83 M104
M106 M107 M109 M112 M114 M115 M118 M120 M121 M140 M190 M220 M221 M291 M292 M486
M550 M562 M568 M593 M701 M702 M703 M955 M956 M999`.

**Emitted by the UI and NOT executed by the mock** — verified against
`packages/ui/src/control/commands.ts`:

| Code | What it does on the board | On the mock |
|---|---|---|
| `G4` | Dwell | silently no-ops |
| `G29` | Mesh bed probe; writes `heightmap.csv` | silently no-ops |
| `G32` | Bed tramming from `bed.g` | silently no-ops |
| `M37` | Simulation mode | silently no-ops |
| `M80` / `M81` | ATX power on/off | silently no-ops |
| `M84` | Motors off (drops homed state) | silently no-ops |
| `M98` | **Run a macro file** | silently no-ops |
| `M290` | Babystepping | silently no-ops |
| `M400` | Wait for moves to finish | silently no-ops |
| `M997` | Firmware update | silently no-ops |

Each verified live against a running mock, 2026-08-28: every one returns
`{"err":0}` with an empty `rr_reply` — indistinguishable from success.

Consequence for UAT: a control that emits one of these **cannot be verified on
the mock**. The button will look like it worked. Treat a green mock run of the
bed-tram, heightmap, babystepping, ATX, simulation, firmware-update or
**run-macro** surfaces as *untested*, and say so rather than reporting them
exercised. `M98` deserves its own note: the Macros view's whole purpose is
running macro files, and on the mock every run appears to succeed and does
nothing.

This table is machine-checked by `packages/ui/test/mock-parity.test.ts`, which
fails if the mock gains or loses one of these codes without this file being
updated — the doc going stale is the failure mode a prose parity list normally
has, and it is the one thing here that could be prevented by construction.

## 2. Object model

**Served** (`src/snapshot.ts` `createBaseModel`, or a capture via `--snapshot`):
`boards directories fans global heat inputs job ledStrips limits messages move
network sensors spindles state tools volumes`, plus `seqs`, which the mock
**synthesises** — an SBC capture carries none, and `seqs` is standalone-only
(see the `rrf-object-model` skill).

**The real board's own capture** (`captures/duet3-real-2026-07-15/model/`) was
taken with the keys DWC queries: verbose `boards fans global heat inputs job move
network sensors spindles state tools`, and a live `d99fn` projection carrying
`boards fans heat inputs job move sensors seqs spindles state tools`.

**Not served, and not currently read by the UI:** `httpEndpoints`,
`userSessions`, `scanner`. SBC-only keys (`sbc`, `plugins`) are dropped from
captures on purpose — this project targets standalone first, and a key the
standalone board never sends must not appear to work here.

**Unverified:** whether the real 3.6.3 board emits any top-level key absent from
both the capture and the list above. The capture is a snapshot of what DWC asked
for, not proof of the board's full surface. Do not read this section as an
exhaustive statement about the firmware.

## 3. HTTP: the `rr_` dialect

**Full parity on the endpoints the UI uses.** The connector
(`packages/connector/src/`) reaches for `rr_connect rr_disconnect rr_model
rr_gcode rr_reply rr_upload rr_download rr_delete rr_mkdir rr_move rr_filelist
rr_fileinfo rr_thumbnail`, and the mock answers every one, plus `rr_files`.

Behaviours the mock models on purpose, because the real server's scarcity is
what the UI has to survive:

- **503 (firmware busy)** on every nth `rr_model` / `rr_filelist` / `rr_files` —
  `--busy-every <n>`, off by default.
- **Session scarcity** — `--max-sessions` (default 4, matching RRF) and
  `--session-timeout`. Raise them ONLY to work around a known leak during UAT; a
  high cap hides that whole class of bug.
- **Chunked `rr_model`** — `--chunk-size`, default 8 elements per response, so
  the connector's stitching loop is exercised rather than assumed.
- **`rr_reply` expiry** — `--reply-expiry`, default 3000 ms.
- **CRC32 verification on `rr_upload`**, with a bad CRC rejected.

**Not modelled:** the real server's connection ceiling and its behaviour under
genuine socket exhaustion. The mock is a Node HTTP server and will happily accept
more concurrency than a Duet ever would. Load-shaped defects do not show up here.

## 4. HTTP: the DSF (SBC) surface

Served under `--dsf` (`src/dsf.ts`): `machine/connect`, `machine/disconnect`,
`machine/noop`, `machine/model`, `machine/status`, `machine/code`,
`machine/file/*`, `machine/file/move`, `machine/directory/*`,
`machine/fileinfo/*`, and the `/machine` WebSocket push loop.

The connector uses `machine/connect`, `machine/model`, `machine/status` and
`machine/code`, so those are covered. **Not served:** the plugin surface
(`machine/plugins`, `startPlugin`, `systemPackages`) and everything else DSF
exposes for the SBC's own management. The UI does not use them, and a mock that
answered them would invite code that depends on a mode this project targets
second.

**Deployment asymmetry, and it is a real one:** DuetWebServer (Kestrel) neither
compresses on the fly nor serves `.gz` transparently — verified on hardware
2026-07-24, and a `.gz` deploy 404s every asset. The mock does not model asset
serving at all, so **no packaging or compression decision can be validated
here.** See `CLAUDE.md` § Hard constraints.

## 5. Files and the SD card

The virtual SD (`src/files.ts`) seeds `0:/sys` (including `config.g`, `bed.g`,
`homeall.g`, the pause/resume/stop scripts and `dwc-ng-config.json`),
`0:/macros`, `0:/gcodes`, `0:/filaments` (as directories holding their macros,
which is how the real board carries them), `0:/firmware`, `0:/menu`, `0:/www`.

`rr_fileinfo` and `rr_thumbnail` serve real captured metadata, including the
seat-support QOI thumbnail across multiple chunks.

**Not modelled:** free-space and card-full behaviour, write failures mid-upload,
a second volume being unmounted while in use, and file timestamps drifting from
the board's clock. `rr_filelist` DOES report err 1 (unmounted) and err 2
(missing).

## 6. States the mock can present ON PURPOSE

The point of this section: each of these exists because the UI has real
behaviour for the state, and closing an earlier gap would otherwise have made it
unreachable. **Do not remove one to make the default machine tidier.**

| Flag / option | Presents |
|---|---|
| *(default)* | An identified 4-tool, 7-axis toolchanger with a current-version config — the owner's machine |
| `--unidentified` | No `boards[].uniqueId`, no interface MAC: the UI's unidentified path — the identity card's "Not identified" branch, and `nullCanvasKeys`, the in-memory canvas that writes nowhere (verified live 2026-08-28: zero `dwc-ng.m.*` keys in the browser) |
| `--frozen-screen` | A pre-#86 `screens.layouts` override naming a SUBSET of a screen's coded cards, with no tombstones — the state every operator who ever pressed Save was in |
| `--config-version 1` / `2` | A pre-v3 config file on the card, so the migration path a real SD can still carry is reachable live, not only in the parser's own tests |
| `--snapshot ""` | The bare synthetic Duet 3 Mini 5+ instead of the toolchanger capture: one tool, fewer axes |
| `--state <file>` | State that survives a restart, so a migration has something an older build actually wrote |
| `--busy-every`, `--max-sessions`, `--session-timeout` | A server as scarce as the real one |
| `-s heater-fault`, `-s disconnect`, `-s mid-print`, `-s shaping` | Fault, outage, an active job, and a shaping run with synthesised accelerometer CSVs |

**Combinations are legal and are the interesting cases** — an unidentified
four-tool machine with a seeded config is one call, and the flags read no state
from each other by design.

### States that are NOT presentable, and should be

Recorded here rather than discovered later. Each is a real UI path with no way
to drive it on the mock today; closing one means a flag, in the shape of the
table above.

- **"Claimed, not adopted"** — an IDENTIFIED machine reading an SD config
  stamped for a DIFFERENT machine. The seed is always stamped for the mock's own
  id, and `--unidentified` does not produce it either: `loadFromMachine` takes
  its `handle === null` branch while unidentified and sets no claim at all
  (`config/store.ts`). This was assumed to fall out of `--unidentified` while
  writing this file, and checking it in a browser is what showed otherwise.
- **A second machine.** Every machine-identity behaviour that involves moving
  between two boards — a layout or profile written for machine A being refused
  on machine B — needs two mocks on two ports and a browser pointed at each in
  turn. Nothing stops that, but no single invocation presents it.
- **An SD card that fills up mid-upload**, and every other write failure (§5).

## 7. What the mock cannot tell you, in one list

Read this before reporting anything as "verified on the mock":

1. Any control emitting `G29 G32 M290 M400 M80 M81 M84 M997` (§1).
2. Anything about asset packaging, compression or `.gz` serving (§4).
3. Anything about real concurrency limits or socket exhaustion (§3).
4. Anything about card-full, write failure, or clock skew (§5).
5. Motion physics: the mock moves axes instantly to their target and does not
   model acceleration, jerk, or a move queue. Timing-dependent UI (progress
   estimation, live position smoothness) behaves better here than on hardware.
6. Whether the real firmware accepts a G-code's exact spelling. The mock parses
   what it was taught; `reference/dwc` and the board are the authorities, per
   `CLAUDE.md`.
