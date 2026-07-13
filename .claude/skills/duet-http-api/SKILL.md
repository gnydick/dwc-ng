---
name: duet-http-api
description: Reference for the Duet/RRF HTTP APIs used by dwc-ng — the standalone `rr_` dialect (primary) and the DSF/SBC `/machine/` REST API (future connector). Use whenever implementing or reviewing any HTTP call to a Duet board: rr_connect/sessions, rr_model queries, rr_gcode + rr_reply, rr_upload/download/filelist, or the SBC equivalents. Source endpoint details from the bundled OpenAPI specs and the vendored `@duet3d/connectors` PollConnector under reference/, never from memory — the specs are authoritative and versioned.
---

# Duet / RRF HTTP API reference

This project talks to Duet3D boards two ways. Implement the first now; keep
the second in mind so the connector abstraction stays clean.

- **Standalone (`rr_` API)** — RRF's embedded HTTP server serves the API
  directly. **This is what we build against first.** Authoritative spec:
  [`standalone-OpenAPI.yaml`](./standalone-OpenAPI.yaml) (RRF 3.6.0).
- **DSF / SBC (`/machine/` REST API)** — Duet Software Framework running on a
  companion SBC (e.g. Raspberry Pi). A future bolt-on behind the connector
  interface. Spec: [`sbc-OpenAPI.yaml`](./sbc-OpenAPI.yaml) (DSF 3.4.6).

**Always read the relevant spec before writing a request.** The YAML is the
source of truth for parameter names, required-ness, and error codes. This
file is a map and a warning list, not a replacement for the spec.

## The environment shapes every decision

RRF's embedded server (standalone mode) is weak: very few concurrent
connections, small output buffers, and each request is expensive (see
CLAUDE.md hard constraints). The API is designed around that, and so must our
client:

- **Minimize request count and payload.** Prefer `seqs`-driven `rr_model`
  re-fetches of changed subtrees over polling everything.
- **Expect 503 "insufficient RAM / busy" and retry.** Several endpoints
  (`rr_model`, `rr_filelist`, `rr_files`) document a `503` when the board is
  short on memory. Treat 503 as *transient* — back off and retry, do not
  surface as a hard error.
- **Fetch replies promptly.** `rr_reply` is buffered per HTTP client and
  discarded ~1s after the code completes if unread (see below).

## Standalone `rr_` endpoint map

Line numbers point into `standalone-OpenAPI.yaml`. Read the section before
using the endpoint.

| Endpoint | Line | Purpose |
|---|---|---|
| `rr_connect` | 8 | Log in (optional password), open session. Sets board clock via `time`. `err`: 0 ok, 1 bad password, 2 no sessions free. Returns `sessionTimeout`. |
| `rr_disconnect` | 45 | Close session (frees a session slot). |
| `rr_status` | 61 | **Deprecated** (RRF 3.0+). Use `rr_model`. |
| `rr_config` | 88 | Static config snapshot. |
| `rr_gcode` | 101 | Execute G/M/T-code. `gcode` param required (may be empty). Returns `bufferSpace`. |
| `rr_reply` | 124 | Last G-code reply, `text/plain`. Per-client buffer, dropped ~1s if unread. |
| `rr_upload` | 135 | POST file (octet-stream body). `name` required; `crc32` (hex, no `0x`) encouraged; `time` optional. GET returns last upload `err`. |
| `rr_download` | 194 | GET file. 404 if missing. |
| `rr_delete` | 212 | Delete file/dir. `recursive=yes|no`. |
| `rr_filelist` | 242 | Paginated dir listing *with* attributes (type/size/date). Paginate via `first` + response `next` (0 = done). |
| `rr_files` | 320 | Paginated filenames only (lighter than `rr_filelist`). `flagDirs` prefixes dirs with `*`. |
| `rr_model` | 388 | **The core live-data call.** `key` + `flags`. See below. |
| `rr_move` | 423 | Move/rename file. |
| `rr_mkdir` | 459 | Create directory. |
| `rr_fileinfo` | 482 | Parse job file metadata (height, filament, thumbnails offsets…). |
| `rr_thumbnail` | 561 | Fetch an embedded G-code thumbnail. |

### `rr_model` — the poll loop's workhorse

`rr_model?key=<key>&flags=<flags>` mirrors `M409`. The response echoes `key`,
`flags`, a `result`, and (for arrays) a `next` offset. This is how we keep the
UI a live mirror of the object model: watch `seqs` counters, then re-fetch only
changed subtrees with chunked queries, and merge by wholesale subtree
replacement.

> The spec documents `flags` only as an opaque string. The **authoritative**
> flag recipes and chunking loop are in the vendored connector —
> `reference/connectors/src/PollConnector.ts` (`@duet3d/connectors` 3.6.0).
> Read it before changing any `rr_model` call. Key facts from that source:

- **Live poll** (every cycle): `rr_model?flags=d99fn` — returns all
  frequently-changing values plus the `seqs` object (`PollConnector.ts:544`).
- **Full subtree fetch** (on connect, or when a `seqs` counter advanced):
  flags `d99vno` per key (`:517`, `:575`).
- **Flag letters** (`d99fn` / `d99vno`) — authoritative definitions in
  `reference/rrf-m409-object-model.md`: `d<n>` = max reported depth (objects
  deeper than `n` come back as `{}`); `f` = only frequently-changing (live)
  values; `v` = verbose, include rarely-needed values; `n` = **include**
  fields with null values; `o` = include obsolete fields; `a<offset>` = array
  start index for chunking. So `d99fn` = live values, depth 99, keep nulls;
  `d99vno` = full snapshot, depth 99, verbose + nulls + obsolete. Flags may be
  comma/space separated.
- **Chunked arrays**: `queryObjectModel` appends `a<next>` and loops,
  concatenating `result` until the response `next` is 0
  (`PollConnector.ts:469-485`). Large arrays (e.g. `move.axes`) are fetched
  this way.
- **Standalone ignores** `messages`, `plugins`, `sbc` (`:20`) — don't poll
  them via the key loop.
- Full `seqs` semantics live in
  [`rrf-object-model`](../rrf-object-model/SKILL.md).

### `rr_gcode` + `rr_reply` — the shared reply buffer

Sending a code and reading its reply are two calls: `rr_gcode?gcode=...`
queues the command (respect the returned `bufferSpace` for flow control),
then `rr_reply` drains the text result. The reply buffer is **per HTTP
client** and **discarded ~1 second after completion if not fetched**, so the
connector must drain `rr_reply` promptly after each code. Missed replies are
gone — there is no replay.

### `rr_upload` — verify with CRC32

Uploads are `POST` with the file bytes as the `application/octet-stream`
body and `name` in the query. Pass `crc32` (hex string, no leading `0x`);
the spec says its use is *encouraged* and `err=1` on a CRC mismatch. Always
send it and check the result — silent corruption on a flaky embedded server
is exactly the failure mode CRC guards against.

### Pagination: `rr_filelist` / `rr_files`

Both cap output to fit RRF's buffers, so large directories come back in
pages. Start at `first=0`, read items, then re-request with
`first = response.next` until `next === 0`. `err`: 0 ok, 1 drive not
mounted, 2 directory missing. Use `rr_files` when you only need names
(cheaper); `rr_filelist` when you need size/date/type.

## DSF / SBC `/machine/` API (future)

Only relevant when the SBC connector is built. Line numbers into
`sbc-OpenAPI.yaml`:

| Endpoint | Line | rr_ analogue |
|---|---|---|
| `/machine/connect` | 8 | `rr_connect` |
| `/machine/disconnect` | 53 | `rr_disconnect` |
| `/machine/noop` | 44 | keepalive |
| `/machine/model` | 66 | `rr_model` (full OM) |
| `/machine/status` | 77 | status snapshot |
| `/machine/code` | 88 | `rr_gcode` + reply combined |
| `/machine/file/{filename}` | 115 | `rr_download`/`rr_upload`/`rr_delete` |
| `/machine/fileinfo/{filename}` | 196 | `rr_fileinfo` |
| `/machine/file/move` | 223 | `rr_move` |
| `/machine/directory/{directory}` | 256 | `rr_filelist` / `rr_mkdir` |
| `/machine/plugin` … `stopPlugin` | 320+ | (DSF-only; no rr_ equivalent) |

The key architectural takeaway: DSF returns the **whole** object model and
combines code+reply, whereas standalone forces chunked `rr_model` and a
separate reply drain. The connector interface must abstract over that
difference — design it so neither side leaks into the UI layer.
