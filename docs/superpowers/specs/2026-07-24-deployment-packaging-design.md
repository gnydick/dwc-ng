# Deployment packaging — design

**Date:** 2026-07-24
**Status:** approved (design); implementation plan pending
**Target board for verification:** `duet3.nydick.net` (Duet 3 + SBC, DSF/DuetWebServer)

## Goal

Turn a `pnpm build` into something that lands on a Duet board and demonstrably
works, without putting the machine's only working UI at risk.

## Verified facts about the target

Every claim below was tested against the real board over the DSF REST API on
2026-07-24. Nothing here is inferred from documentation, and two earlier
assumptions were falsified in the process — recorded so they are not
re-derived.

| Claim | Method | Result |
|---|---|---|
| `0:/www` holds the stock DWC install | `GET /machine/directory/0:/www` | `index.html`, `js/`, `css/`, `fonts/`, `img/`, `service-worker.js`, `workbox-*.js`, `DuetAPI.xml` |
| Stock DWC on SBC ships **uncompressed** | directory listings of `js/`, `css/`, `fonts/` | plain `.js`/`.css`/`.woff2`, no `.gz` anywhere |
| Stock DWC ships sourcemaps to the SD card | same | `monaco-editor.*.js.map` = **15,234,312 bytes** |
| Kestrel does **not** compress on the fly | `GET /css/app.*.css` with and without `Accept-Encoding: gzip` | identical `Content-Length: 917527`, no `Content-Encoding` |
| Kestrel does **not** serve `.gz` transparently | uploaded a real 53-byte `probe.txt.gz`, then `GET /ng/probe.txt` | **404** (`GET /ng/probe.txt.gz` → 200, raw gzip bytes) |
| Path mapping `0:/www/ng/X` → `/ng/X` | upload + fetch | works |
| `PUT` auto-creates nested directories | `PUT …/ng/assets/app.js` with no prior mkdir | `assets/` created |
| Correct MIME types are served | `GET /ng/assets/app.js` | `Content-Type: text/javascript` |
| **`/ng/` does NOT serve `0:/www/ng/index.html`** | upload marker, `GET /ng/` | returns **DWC's shell** (SPA fallback) |
| `/ng/index.html` and `/ng.html` do serve our files | `GET` each | correct content |
| Writes require **no authentication** | every `PUT`/`DELETE` above | all succeeded anonymously |

### Falsified along the way

- **"CLAUDE.md says pre-gzip, so pre-gzip."** That constraint is a *standalone
  RRF* convention. On DSF, shipping `.gz` actively breaks the app: the browser
  requests `index.js` and receives a 404.
- **"A subdirectory deploy is reachable at its directory URL."** ASP.NET Core
  maps a directory to `index.html` only where `UseDefaultFiles()` is
  configured. DuetWebServer applies it at the root only, so `/ng/` silently
  falls through to DWC — a failure that looks like "I deployed and nothing
  changed."

A methodological note worth keeping: the first `.gz` test was run against a
**0-byte** file, because `curl -X PUT --data-binary @f` sent no body. It
produced the right answer for the wrong reason. The correct form is `curl -T`.
Any future probe must assert the uploaded size on the board before drawing a
conclusion from how it is served.

## Deployment layout

Side-by-side with DWC, entry at an extensioned path so it bypasses the SPA
fallback:

```
0:/www/
  index.html      ← stock DWC, untouched
  js/ css/ fonts/ ← stock DWC, untouched
  ng.html         ← dwc-ng entry
  ng/
    assets/…      ← built with base: '/ng/'
```

Entry: `http://<board>/ng.html`. With the hash router, deep links are
`/ng.html#/machine`.

DWC keeps working throughout. A broken dwc-ng deploy costs nothing and is
removable by deleting `ng.html` and `ng/`.

## What ships

The deployable tree is `dist/` minus `**/*.map`.

Sourcemaps are excluded because SD space and upload time are real costs and
stock DWC's 15 MB of maps demonstrate the failure mode. The packager **fails**
if a `.map` reaches the manifest rather than filtering silently, so the
exclusion cannot rot into a no-op.

## Build

`base` becomes environment-driven (`DWC_BASE`, default `/`). Vite bakes
absolute asset paths into `index.html` at build time, so a `/ng/` deploy
**cannot** be produced by relocating files afterwards — it must be built with
`base: '/ng/'`. The entry HTML is emitted as `index.html` by Vite and uploaded
to `ng.html`; assets keep their `/ng/…` references.

## Compression is derived from the transport

| Target | Server | Ships |
|---|---|---|
| DSF / SBC | Kestrel | plain files |
| Standalone | RRF embedded | `.gz` |

Pairing "DSF" with "gzip" produces a wholly broken deploy, so the pairing must
not be expressible. Compression mode is a property *of* the transport, not a
separate argument threaded alongside it — there is no call site at which the
two can disagree.

## Upload

New workspace package `packages/deploy`, zero dependencies, mirroring the
existing connector seam:

- **DsfTransport** — `PUT /machine/file/{path}`
- **PollTransport** — `rr_upload` + CRC32

Uploads are idempotent: files already present and unchanged are skipped. This
matters most for standalone, where requests are expensive and connections
scarce, but it is one code path.

## Verification — what makes this safe

A deploy proves itself before reporting success:

1. `GET /ng.html` → 200 **and bytes match what was uploaded.** A status check
   alone is insufficient: the SPA fallback returns DWC's shell with a 200, so
   a missing entry file would otherwise report success.
2. `GET` the eager entry JS → 200 with a **JavaScript** content-type. Same
   trap: a missing asset must not pass as `text/html`.
3. Assert no `.map` is reachable on the board.

Also: `--dry-run` (manifest and byte counts, no writes) and an uninstall that
removes `ng.html` and `ng/`.

## Testing

mock-duet already implements both dialects — `rr_upload` + CRC32
(`server.ts:197`, `crc32.ts`) and DSF `PUT /machine/file/` (`dsf.ts:280`). The
full matrix runs without hardware: plain/gzip × DSF/standalone, idempotent
re-deploy, the SPA-fallback trap, `.map` leakage, and the 0-byte-upload
regression.

## Follow-ups (not in this scope)

- **CLAUDE.md line 15** ("Emit pre-gzipped assets (RRF serves .gz
  transparently)") is now demonstrably wrong for DSF and should be scoped to
  standalone. Editing a hard-constraints doc is the owner's call.
- **Bundle size.** Eager path is 96.9 KB gz (inside the ~300 KB target); total
  is 665 KB gz, over 2× it, because Babylon is 232 KB gz. Read as governing
  the eager path this passes; read as total it does not. Separate decision.
- **Unauthenticated writes.** The board accepts anonymous `PUT`/`DELETE` to its
  filesystem from any LAN host. Not introduced by this work, but it is the
  security posture the deploy runs against, and worth a deliberate decision.
