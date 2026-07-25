# Deployment Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `packages/deploy` that turns `dist/` into a verified deployment on a Duet board, side-by-side with stock DWC.

**Architecture:** A zero-dependency Node package mirroring the existing connector seam. A pure manifest builder scans `dist/`, drops sourcemaps, and remaps paths to the board layout. Two transports (DSF `PUT`, standalone `rr_upload`+CRC32) each *carry* their own compression mode, so a DSF+gzip deploy is not expressible. A verification pass proves the deploy by content, not by status code.

**Tech Stack:** TypeScript via Node's native type stripping (Node ≥ 23), `node --test`, zero runtime dependencies.

## Global Constraints

- **Zero runtime dependencies.** Dependency policy in CLAUDE.md: never add one without asking.
- **Node native TS type stripping.** `tsconfig` must set `erasableSyntaxOnly: true`, `verbatimModuleSyntax: true`, `allowImportingTsExtensions: true`, `strict: true`, `noUncheckedIndexedAccess: true`, `noEmit: true` — copy `packages/mock-duet/tsconfig.json`.
- **Imports use explicit `.ts` extensions** (NodeNext + type stripping).
- **Never gzip for DSF.** Verified 2026-07-24: Kestrel 404s a transparent `.gz` fetch.
- **No size gate.** Ships what the build produces, minus sourcemaps.
- **Board layout:** entry HTML → `0:/www/ng.html`; everything else → `0:/www/ng/…`; build with `base: '/ng/'`.
- **Typecheck with `npx tsc -b --force`** — plain `--noEmit` checks zero files at the root.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/deploy/package.json` | Package manifest, scripts |
| `packages/deploy/tsconfig.json` | Copy of mock-duet's |
| `packages/deploy/src/manifest.ts` | Pure: scan a dir → `DeployFile[]`, drop `.map`, remap to board paths |
| `packages/deploy/src/transport.ts` | `Transport` interface; compression is a property of the transport |
| `packages/deploy/src/dsfTransport.ts` | DSF: `PUT/GET/DELETE /machine/file/`, `plain` |
| `packages/deploy/src/pollTransport.ts` | Standalone: `rr_upload` + CRC32, `gzip` |
| `packages/deploy/src/crc32.ts` | IEEE CRC-32 (our own implementation) |
| `packages/deploy/src/deploy.ts` | Orchestration: manifest → upload (idempotent) → verify |
| `packages/deploy/src/verify.ts` | Post-deploy proof by content |
| `packages/deploy/src/cli.ts` | Arg parsing, human output |
| `packages/deploy/test/*.test.ts` | Tests against mock-duet |

---

### Task 1: Package scaffold + manifest builder

**Files:**
- Create: `packages/deploy/package.json`, `packages/deploy/tsconfig.json`, `packages/deploy/src/manifest.ts`
- Test: `packages/deploy/test/manifest.test.ts`

**Interfaces:**
- Produces: `type DeployFile = { local: string; board: string; bytes: Uint8Array }`, `buildManifest(distDir: string, opts: { name: string; gzip: boolean }): Promise<DeployFile[]>`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildManifest } from "../src/manifest.ts"

test("index.html becomes <name>.html; everything else nests under <name>/", async () => {
  const files = await buildManifest(fixtureDir, { name: "ng", gzip: false })
  const board = files.map(f => f.board).sort()
  assert.deepEqual(board, ["ng.html", "ng/assets/app.js"])
})

test("sourcemaps never reach the board", async () => {
  const files = await buildManifest(fixtureWithMaps, { name: "ng", gzip: false })
  assert.equal(files.filter(f => f.board.endsWith(".map")).length, 0)
})

test("a .map that survives remapping is a hard failure, not a silent skip", async () => {
  await assert.rejects(() => buildManifest(dirWhereFilterIsBypassed, { name: "ng", gzip: false }))
})

test("gzip mode appends .gz and compresses", async () => {
  const files = await buildManifest(fixtureDir, { name: "ng", gzip: true })
  assert.ok(files.every(f => f.board.endsWith(".gz")))
})
```

- [ ] **Step 2: Run to verify failure** — `cd packages/deploy && node --test` → FAIL, module not found
- [ ] **Step 3: Implement `manifest.ts`** — recursive readdir, filter `**/*.map`, remap, optional `gzipSync` from `node:zlib`, assert-no-map before returning
- [ ] **Step 4: Run tests** → PASS
- [ ] **Step 5: Commit** — `feat(deploy): manifest builder that cannot ship a sourcemap`

---

### Task 2: Transport seam + DSF transport

**Files:**
- Create: `packages/deploy/src/transport.ts`, `packages/deploy/src/dsfTransport.ts`
- Test: `packages/deploy/test/dsfTransport.test.ts`

**Interfaces:**
- Produces:
```ts
type Transport = {
  readonly kind: "dsf" | "poll"
  readonly gzip: boolean          // derived from kind, never passed in
  put(boardPath: string, bytes: Uint8Array): Promise<void>
  read(boardPath: string): Promise<Uint8Array | null>
  remove(boardPath: string): Promise<void>
  fetchUrl(urlPath: string): Promise<{ status: number; contentType: string; bytes: Uint8Array }>
}
declare function dsfTransport(baseUrl: string): Transport   // gzip: false
```

- [ ] **Step 1: Write the failing test** — start mock-duet in DSF mode, `put` a file, `read` it back, assert bytes match; assert `dsfTransport(...).gzip === false`
- [ ] **Step 2: Run to verify failure**
- [ ] **Step 3: Implement** — `PUT/GET/DELETE /machine/file/{encoded}`; percent-encode the `0:/` prefix
- [ ] **Step 4: Run tests** → PASS
- [ ] **Step 5: Commit** — `feat(deploy): DSF transport; compression is a property of the transport`

---

### Task 3: CRC32 + standalone transport

**Files:**
- Create: `packages/deploy/src/crc32.ts`, `packages/deploy/src/pollTransport.ts`
- Test: `packages/deploy/test/pollTransport.test.ts`

**Interfaces:**
- Produces: `crc32(bytes: Uint8Array): number`, `pollTransport(baseUrl: string): Transport` (`gzip: true`)

- [ ] **Step 1: Write the failing test** — known CRC-32 vectors (`""` → 0, `"123456789"` → `0xCBF43926`); `rr_upload` round-trip against mock-duet; assert `gzip === true`
- [ ] **Step 2: Run to verify failure**
- [ ] **Step 3: Implement** — table-driven IEEE CRC-32, our own; `rr_upload?name=…&crc32=…`
- [ ] **Step 4: Run tests** → PASS
- [ ] **Step 5: Commit** — `feat(deploy): standalone rr_upload transport with CRC32`

---

### Task 4: Idempotent deploy orchestration

**Files:**
- Create: `packages/deploy/src/deploy.ts`
- Test: `packages/deploy/test/deploy.test.ts`

**Interfaces:**
- Consumes: `buildManifest`, `Transport`
- Produces: `deploy(distDir, transport, opts: { name: string; dryRun?: boolean }): Promise<{ uploaded: string[]; skipped: string[] }>`

- [ ] **Step 1: Write the failing test**

```ts
test("a second deploy of identical output uploads nothing", async () => {
  await deploy(dist, t, { name: "ng" })
  const second = await deploy(dist, t, { name: "ng" })
  assert.equal(second.uploaded.length, 0)
  assert.ok(second.skipped.length > 0)
})

test("dry run writes nothing", async () => {
  const r = await deploy(dist, t, { name: "ng", dryRun: true })
  assert.equal(await t.read("0:/www/ng.html"), null)
  assert.ok(r.uploaded.length > 0)   // reports what it *would* do
})

test("gzip is taken from the transport, not the caller", () => {
  // deploy() has no compression parameter — this is a type-level guarantee
})
```

- [ ] **Step 2: Run to verify failure**
- [ ] **Step 3: Implement** — read-back comparison per file, skip identical, honour `dryRun`
- [ ] **Step 4: Run tests** → PASS
- [ ] **Step 5: Commit** — `feat(deploy): idempotent upload with dry-run`

---

### Task 5: Verification that cannot be fooled by the SPA fallback

**Files:**
- Create: `packages/deploy/src/verify.ts`
- Modify: `packages/deploy/src/deploy.ts` (call verify after upload)
- Test: `packages/deploy/test/verify.test.ts`

**Interfaces:**
- Produces: `verify(transport, manifest, opts: { name: string }): Promise<void>` — throws on any failure

- [ ] **Step 1: Write the failing test**

```ts
test("a 200 carrying the WRONG bytes fails verification", async () => {
  // the exact DWC-fallback trap: /ng.html returns 200 with someone else's HTML
  await assert.rejects(() => verify(fallbackServingTransport, manifest, { name: "ng" }),
    /content mismatch/i)
})

test("an entry chunk served as text/html fails verification", async () => {
  await assert.rejects(() => verify(htmlForJsTransport, manifest, { name: "ng" }),
    /content-type/i)
})

test("a reachable .map fails verification", async () => {
  await assert.rejects(() => verify(mapLeakTransport, manifest, { name: "ng" }), /\.map/)
})
```

- [ ] **Step 2: Run to verify failure**
- [ ] **Step 3: Implement** — fetch `{name}.html`, byte-compare against the manifest; parse the entry `<script src>` from the HTML, fetch it, assert a JS content-type; probe one `.map` path and require non-200
- [ ] **Step 4: Run tests** → PASS
- [ ] **Step 5: Commit** — `feat(deploy): prove the deploy by content, not by status code`

---

### Task 6: CLI + build wiring

**Files:**
- Create: `packages/deploy/src/cli.ts`
- Modify: `packages/ui/vite.config.ts` (env-driven `base`), root `package.json` (scripts)
- Test: `packages/deploy/test/cli.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces: `pnpm deploy --target <url> [--mode dsf|poll] [--name ng] [--dry-run] [--uninstall]`

- [ ] **Step 1: Write the failing test** — arg parsing: unknown mode rejected; missing `--target` rejected; `--dry-run` implies no writes
- [ ] **Step 2: Run to verify failure**
- [ ] **Step 3: Implement** — `base: process.env.DWC_BASE ?? '/'` in vite config; `cli.ts`; root scripts `build:ng` and `deploy`
- [ ] **Step 4: Run tests + `npx tsc -b --force`** → PASS
- [ ] **Step 5: Commit** — `feat(deploy): CLI and env-driven base`

---

### Task 7: Live deploy to the board

**Files:** none (operational)

- [ ] **Step 1:** `DWC_BASE=/ng/ pnpm build` (set `$BOARD` to your board's URL first)
- [ ] **Step 2:** `pnpm ship --target $BOARD --mode dsf --dry-run` — review the manifest
- [ ] **Step 3:** `pnpm ship --target $BOARD --mode dsf`
- [ ] **Step 4:** Confirm `$BOARD/ng.html` loads in a browser and connects to the board; confirm `$BOARD/` still serves stock DWC
- [ ] **Step 5:** Commit any fixes; record the result

---

## Self-Review

**Spec coverage:** layout §"Deployment layout" → Tasks 1, 6, 7. `.map` exclusion §"What ships" → Task 1. `base` §"Build" → Task 6. Transport-derived compression §"Compression…" → Tasks 2, 3. Idempotence §"Upload" → Task 4. Content-proof verification §"Verification" → Task 5. mock-duet testing §"Testing" → Tasks 2–5. Uninstall → Task 6. Follow-ups are out of scope by design.

**Placeholders:** none — every step names files, commands, and expected outcomes.

**Type consistency:** `DeployFile`, `Transport`, `buildManifest`, `deploy`, `verify`, `crc32` are used with identical signatures across Tasks 1–6. `gzip` is the property name throughout (never `compression`).
