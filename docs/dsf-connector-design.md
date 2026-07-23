# DSF connector — design (campaign 2026-07-23)

A second, native transport for SBC machines: `DsfConnector` speaks DSF's
`/machine` WebSocket + REST API and slots in UNDER the day-one connector
abstraction. Nothing above `Connector` changes behavior. Standalone (rr_)
remains the default and the first-class path.

Grounding: five-agent recon (protocol from vendored @duet3d/connectors
3.6.0; our surface contracts; REST routes cross-checked against the
bundled DSF 3.4.6 OpenAPI spec AND live-verified read-only against the
real board 2026-07-23; zero-dep RFC6455 harness proven empirically under
`node --conditions=browser --test`; completeness critic). Live wire facts
from the board: first WS frame = full model (~96 KB, job.layers included,
281 entries), then sparse diffs (~90 B) gated on `"OK\n"` acks;
`"PING\n"`/`"PONG\n"` answered; close code 1006 on teardown is routine.

**The reference rule stands: reference/ taught us the protocol; every line
here is written fresh against this design.**

## Decisions (each resolves a recon open question)

D1. **Patch translation happens in a connector-private model copy.**
DSF's merge semantic (absent = unchanged, null = null, arrays always
full-length with element-wise partial merges, shorter array = shrink) is
applied by the connector to its OWN plain-data copy of the model. After
each diff, the connector emits `onModelKey(key, copy[key])` for exactly
the top-level keys the diff touched — wholesale replacement through the
store's existing gates. `onModelPatch` is NEVER used by this connector:
the store's element-wise array merge cannot express DSF shrinks, and the
patch path bypasses the conform gate (audit M8). One merge semantic, one
place, and the store's semantics stay untouched.

D2. **`job.layers` travels ONLY via `onJobLayers`.** The private copy's
`job` is emitted with `layers: []` (the store's preservation rule holds
current history until the real emission lands); whenever a diff touches
`job.layers`, the connector emits `onJobLayers(copy.job.layers)`
wholesale. New-print shrink resets correctly; the store keeps ONE
producer per session.

D3. **`messages` is a consumed channel, never model data.** Before
merging a diff into the private copy, `messages` is intercepted:
each entry is formatted (error → `Error: `, warning → `Warning: `) and
emitted via `onReply`; the private copy pins `messages: []` always. This
is the ONLY source of async replies in DSF mode (M118, macro output,
firmware events). Deep-merging it would duplicate console lines forever.

D4. **Reconnect is connector-owned** (our contract; upstream's
caller-driven loop is not mirrored). WS error/close → status
`reconnecting` → loop every 2 s: fresh `GET /machine/connect` (404
tolerated = sessionless pre-3.4-b4), reopen WS, treat first frame as a
brand-new full model (fresh private copy; emit every key + layers +
boardInfo), status `connected`. `InvalidPasswordError` is terminal →
`disconnected` (matches PollConnector). Close codes 1001/1011 (DCS
down/incompatible) keep retrying — DCS restarts are temporary.

D5. **Liveness deadline added.** Upstream sends `PING\n` every 2 s but
has no reply deadline. We add one: any inbound frame resets the clock;
no frame within `2×pingInterval + 1 s` → socket presumed dead → teardown
→ reconnect ladder. A dead socket can otherwise serve week-old truth,
violating the never-silently-stale rule.

D6. **sendCode = `POST /machine/code`** (body = raw code, response text =
reply, trimmed). Resolves fast for silent codes by nature (DSF answers
when done). `DisconnectedError` when not connected — except the e-stop:
`isEmergencyStop(code)` short-circuits to its own direct `fetch` POST
with no status gate, no shared machinery, one transparent re-connect on
401/403, rejection surfaced (the STOP button's alarm depends on it).
Browser per-host connection limits are the residual risk; the e-stop
fetch is its own request and DSF accepts parallel code posts.

D7. **Files.** upload = `PUT /machine/file/{p}` (201 = success; no CRC
exists in this protocol — the types.ts doc is reworded to "verified as
strongly as the transport allows"; `onProgress` unsupported, callers
already treat it optional). download = `GET /machine/file/{p}` → text.
list = `GET /machine/directory/{p}` → FileListEntry verbatim (type,
name, size, date — DSF's `YYYY-MM-DDTHH:mm:ss` is lexicographically
sortable, satisfying the recent-sort contract). mkdir = `PUT
/machine/directory/{p}` . move = `POST /machine/file/move` with
FormData `from`/`to` (+`force: "true"` only when overwrite). remove =
`DELETE /machine/file/{p}` (+`?recursive=true` for directories).
fileinfo = `GET /machine/fileinfo/{p}` → GcodeFileInfo. Thumbnails:
metadata arrives in fileinfo (offset preserved as the opaque token);
`getThumbnail(path, offset)` = `fileinfo?readThumbnailContent=true`,
select by offset, base64-decode → bytes. Paths: the WHOLE virtual path
is one `encodeURIComponent` component (canonical; live board tolerates
raw, but `%`/`#`/`?` filenames would break unencoded) — EXCEPT
file/move, whose paths go raw in form fields. One `machineUrl(route,
path)` builder is the sole encoder.

D8. **Error mapping at one seam**: 401/403 → one transparent
re-`/machine/connect` + replay, then `InvalidPasswordError`; 404 →
`FileNotFoundError(path)` (load-bearing at config boot); ≥500 →
`OperationFailedError`; network/timeout → retry is NOT layered on (DSF
is a Pi, not a starved RRF socket) — failures surface typed.

D9. **Selection seam: a connector factory over a closed transport
union.** `BACKENDS` entries gain `transport: "rr" | "dsf"`;
`createConnector(backend)` (new, the sole construction site) switches
exhaustively. Dev toggle grows: Mock(rr) · Mock(DSF) · Real(rr) ·
Real(DSF). Production default: boot-time probe — `GET machine/status`
with a short timeout succeeds → DSF; else rr_ (standalone RRF has no
/machine routes; the probe fails fast). `switchEndpoint` is DELETED:
cross-transport switching cannot live inside one class, so the dev
toggle persists the choice and `location.reload()`s — the half-switched
state stops existing (rung 8 by elimination). writesArmed already
force-disarms on toggle.

D10. **onBoardInfo gains `transport`**: `"rr" | "rr-emulated" | "dsf"`.
`emulated` keeps meaning "rr_ served by DSF" (PollConnector-only true).
Shell's footer derives SBC wording from transport, not from `emulated`.

D11. **Mock scope: full DSF surface in mock-duet**, gated by
`dsf: true` (option + `--dsf` CLI): the WS `/machine` endpoint on a
zero-dependency RFC6455 TEXT-only layer (strict: refuse fragmentation,
RSV, unmasked client frames with 1002; 16 MiB cap with 1009; close
echo; frame-ping auto-pong; codec in `packages/mock-duet/src/ws.ts`,
one module) plus REST `/machine/{connect,disconnect,noop,code,model,
status,file,directory,fileinfo,file/move}` over the existing Machine.
Sessions holding a WS never idle-expire. The DSF push loop follows the
protocol: full model on accept, then ack-gated diffs computed from the
machine's state (reusing the machine's existing tick/bump machinery).

D12. **Vite proxy**: add `^/machine$` and `^/real/machine$` entries with
`ws: true` (the existing `/.*` patterns cannot match the bare WS path
and nothing proxies Upgrade today). Production SBC is same-origin — no
proxy involved.

D13. **Version floor**: target DSF ≥ 3.4 (sessionless fallback carries
older). `sbc.dsf.version` is available in the pushed model if gating is
ever needed; no separate version probe.

## Invariants (cant-break-by-design; verified in review phase)

| # | Invariant | Construction | Rung |
|---|---|---|---|
| C1 | One transport drives the store per session | `createConnector` factory is the sole construction site; closed `transport` union, exhaustive switch; App holds exactly one connector | 7 |
| C2 | DSF merge semantics applied exactly once | The private-copy applier (`dsfModel.ts`) is the only merge code; the connector emits only wholesale `onModelKey` — the un-conformed patch path is unreachable from this transport | 7 |
| C3 | Every wire byte passes the safe-object kernel | Diff ingestion iterates via `safeEntries`; store gates (isSafeKey + conformModelKey) apply unchanged on emission | 6 |
| C4 | `job.layers` has one producer | Connector strips layers from `job` emissions (always `[]`) and owns `onJobLayers`; store preservation rule unchanged | 6→7 |
| C5 | `messages` can never enter the model | Intercepted and cleared in the one diff-ingestion path before the private copy merge; the copy pins `messages: []` | 7 |
| C6 | Every push acked exactly once | The single `onmessage` handler is the only ack site; ack sent after processing, per message, unconditionally | 6 |
| C7 | The socket cannot be silently dead | Liveness deadline (D5) in the one message/timer path; expiry = teardown + reconnect, never limbo | 6 |
| C8 | Reconnect cannot render stale truth | First frame of every (re)connect REPLACES the private copy wholesale; there is no partial-resume code path at all | 8 |
| C9 | E-stop never blocked, gated, or queued | Recognized at the transport (`isEmergencyStop`) before any status check; own fetch; failures reject | 6 |
| C10 | Write-guard classification inherited | DsfConnector implements `ConnectorReads`/`ConnectorWrites`; guardWrites wraps by interface — zero new guard code | 7 |
| C11 | Path encoding is uniform | `machineUrl()` is the sole URL builder (move's form-field exception lives inside the move method, documented) | 6 |
| C12 | Typed errors only | One `mapResponse` seam produces the five typed classes; no raw Error escapes | 6 |
| C13 | Mock WS frames parse at one codec | `ws.ts` codec is mock-duet's only byte-level WS code; malformed input = named close, never a hang | 7 |
| C14 | Half-switched transports unrepresentable | `switchEndpoint` deleted; toggle = persist + reload | 8 |

## Phases

P1. `mock-duet/src/ws.ts` — RFC6455 codec + upgrade handler (harness
    spec) + its own frame-level test suite (dribble, coalesce, 16/64-bit
    lengths, close/ping/pong, 1002/1009 refusals). Red-checked.
P2. mock-duet DSF mode — REST routes + WS push loop over Machine;
    sessions-hold-WS rule; `--dsf` CLI; tests.
P3. `ui/src/connector/dsfModel.ts` (private-copy applier, pure, heavily
    tested: shrink, null, absent, messages interception, layers
    extraction) + `DsfConnector.ts` (session, WS loop, liveness,
    reconnect, REST files, e-stop) + end-to-end tests against the mock.
P4. Selection seam: `createConnector`, BACKENDS transport entries +
    probe, toggle-reload, vite ws proxy, types doc updates, onBoardInfo
    transport, Shell footer.
P5. Adversarial review (find→verify) + full-suite + bundle check.
P6. Live verification against the Pi: read-only first (connect, model,
    patches, layers, console replies), then supervised writes per the
    verify-before-hardware rule (config save, macro run) with Gabe.

## P6 live results (2026-07-23, duet3.nydick.net, READ-ONLY)

Driven twice: the real `DsfConnector` from node, and the whole app in
Chrome through the dev proxy. Everything below is observed, not inferred.

- connect → `connected` in **0.18 s**; `transport: "dsf"`, board MB6HC.
- Full model: **18 top-level keys** — one fewer than the raw socket sends,
  because `messages` is consumed into the reply channel (C5 confirmed on
  the wire, not just in tests).
- `job.layers`: **281 entries** delivered natively via `onJobLayers` — the
  starvation that motivated this campaign is simply absent here.
- Live diffs flow under the ack loop; liveness quiet-period holds.
- REST reads: `list 0:/gcodes` = 405 entries with lexicographic dates
  (recent-sort correct); `download config.g` = 8954 B; a missing file
  raises **FileNotFoundError** (the config-boot contract); `fileinfo` +
  `getThumbnail` round-trip an opaque offset to **12756 decoded QOI bytes**.
- In the browser: Machine renders 7 axes with role labels, real temps and
  the operator's own sensor names (so the SD config downloaded over DSF);
  Jobs renders the listing and a job's thumbnail/metadata; the footer
  states "SBC · DSF native"; the guard shows WRITES LOCKED on `real-dsf`.

WRITES REMAIN UNVERIFIED against hardware, deliberately (house rule): the
supervised pass covers config save, macro run, and an e-stop — with Gabe
present and writes armed.

Worker rule (standing order): every implementing/reviewing agent reads
`C:/Users/Gabe E. Nydick/.claude/skills/cant-break-by-design/SKILL.md`
FIRST, then this design, then the cited contracts.
