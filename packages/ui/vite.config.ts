import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import solid from 'vite-plugin-solid'

// Dev parity with production: on a real board the UI is served from the SD card
// by RRF itself, so rr_ requests are same-origin. In dev we proxy them to a
// board. The proxy is server-side, so there is no CORS concern.
//
// NOTHING HERE DEFAULTS TO SOMEONE'S MACHINE. A board address, a dev-host
// name and a password are per-developer environment, not project source: this
// file used to carry `?? 'http://duet3.nydick.net'`, `allowedHosts:
// ['bighoss']` and a `'reprap'` password fallback, which silently worked for
// exactly one person and pointed everyone else's "Real" backend at a stranger's
// printer. Set them in .env.local (untracked) — see .env.example.
//
// The local mock IS a project default: it ships in this repo, so pointing at
// it when nothing is configured is a fact about the project, not about a
// person.
const MOCK_TARGET = 'http://127.0.0.1:8970'

// Asset paths are baked into index.html at BUILD time, so a deployment that
// lives under a subdirectory cannot be produced by moving files afterwards —
// it has to be built with the right base. Side-by-side deploys next to stock
// DWC use `DWC_BASE=/ng/ pnpm build`; see packages/deploy.
const base = process.env.DWC_BASE ?? '/'

// Which dialect the board this bundle is being built FOR speaks. Baked in at
// build time, deliberately, because it is already known then: packages/deploy
// targets a specific machine with an explicit --mode, so detecting it again in
// the browser is machinery that should not exist.
//
// There is no default. Production used to hard-code "rr" for every board,
// which drove a DSF/SBC machine through DSF's rr_ EMULATION instead of its
// native /machine API and reported a thinner object model — observed
// 2026-07-24 on the first real deploy. A default is what made that silent, so
// an unset or bogus value FAILS THE BUILD instead: a production bundle that
// never declared its transport cannot be produced.
const TRANSPORTS = ['rr', 'dsf']
const transport = process.env.DWC_TRANSPORT
const isProdBuild = process.argv.includes('build')
if (isProdBuild && !TRANSPORTS.includes(transport ?? '')) {
  throw new Error(
    `DWC_TRANSPORT must be one of ${TRANSPORTS.join(' | ')} for a production build, got ${transport === undefined ? '(unset)' : JSON.stringify(transport)}.\n` +
    `  standalone RRF board:  DWC_TRANSPORT=rr\n` +
    `  Duet 3 + SBC (DSF):    DWC_TRANSPORT=dsf\n` +
    `It must match the board you deploy to — see packages/deploy.`,
  )
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv reads .env / .env.local — process.env alone does NOT, which is why
  // per-developer settings have to come through here to be settable at all.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }

  const target = env['DWC_TARGET'] ?? MOCK_TARGET
  // No fallback: unset means "I have not told this checkout about a board".
  const realTarget = env['DWC_REAL']
  // Vite's DNS-rebinding guard rejects any Host header not on this list; LAN
  // devices reach the dev server by hostname. Comma-separated, empty by
  // default — localhost works regardless.
  const allowedHosts = (env['DWC_ALLOWED_HOSTS'] ?? '').split(',').map(h => h.trim()).filter(Boolean)

  // The "Real" dev backend can only exist if a board was configured. Omitting
  // the routes entirely is the point: a request to /real then fails visibly
  // here instead of being quietly forwarded to whatever address happened to be
  // committed in this file.
  const realProxy: Record<string, ProxyOptions> = realTarget === undefined ? {} : {
    '^/real/rr_.*': { target: realTarget, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/real/, '') },
    // DSF's whole surface, HTTP and WebSocket, in ONE entry: the REST routes
    // (/machine/file, /machine/code, … and the rr_ connector's layer-history
    // enrichment GET /machine/model) and the bare `/machine` WebSocket
    // endpoint, which carries `?sessionKey=…`. The pattern is deliberately
    // unanchored at the end — an anchored `$` cannot match the query string,
    // and a `/.*` form cannot match the bare endpoint at all. ws:true is
    // required for Vite to proxy the Upgrade.
    '^/real/machine': { target: realTarget, changeOrigin: true, ws: true, rewrite: (p: string) => p.replace(/^\/real/, '') },
  }
  if (realTarget === undefined && mode !== 'production') {
    console.info('[dwc-ng] DWC_REAL is not set — the "Real" dev backend is disabled. See .env.example.')
  }

  return {
    base,
    // The declared transport, frozen into the bundle. Vite substitutes it
    // literally, so the branch that does not apply is dead code the minifier
    // removes — a bundle built for one dialect does not carry the other's
    // decision at all.
    define: { __DWC_TRANSPORT__: JSON.stringify(transport ?? 'rr') },
    plugins: [solid()],
    server: {
      host: true, // listen on all interfaces, not just localhost
      allowedHosts,
      proxy: {
        ...realProxy,
        '^/rr_.*': { target, changeOrigin: true },
        '^/machine': { target, changeOrigin: true, ws: true },
      },
    },
  }
})
