import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import solid from 'vite-plugin-solid'

// Dev parity with production: on a real board the UI is served from the SD card
// by RRF itself, so rr_ requests are same-origin. In dev we proxy them to a
// board. The proxy is server-side, so there is no CORS concern.
//
// NOTHING HERE DEFAULTS TO SOMEONE'S MACHINE. A board address, a dev-host
// name and a password are per-developer environment, not project source: this
// file used to carry a specific board's address, a specific dev host name
// and a password fallback, which silently worked for exactly one person and
// pointed everyone else's "Real" backend at a stranger's printer. Set them in
// .env.local (untracked) — see .env.example.
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

// OPTIONAL: pin the board dialect at build time.
//
// A production bundle needs NO configuration. It is served by the printer, so
// it is same-origin — there is no target to name, and no way to know what
// someone will call their machine or which firmware it runs. The dialect is
// therefore discovered at boot (see main.tsx): /machine/status existing IS the
// DSF signature and its absence IS the standalone signature, which is a
// discriminator, not a guess.
//
// Set DWC_TRANSPORT only to SKIP that probe when you already know the answer —
// packages/deploy targets a specific machine with an explicit --mode, so a
// self-deploy can pin it and save a request. Unset means "detect", which is
// the correct behaviour for any bundle whose destination is not known in
// advance. There is deliberately no default value: unset is a distinct state
// meaning "ask the board", never a quiet stand-in for one of the two answers.
const TRANSPORTS = ['rr', 'dsf']
const transport = process.env.DWC_TRANSPORT
if (transport !== undefined && !TRANSPORTS.includes(transport)) {
  throw new Error(
    `DWC_TRANSPORT must be one of ${TRANSPORTS.join(' | ')} when set, got ${JSON.stringify(transport)}.
` +
    `Leave it unset to detect the dialect at boot, which needs no configuration.`,
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
    // null = "not pinned, detect at boot". NOT a dialect: the app branches on
    // null explicitly rather than treating it as one of the two answers.
    define: { __DWC_TRANSPORT__: JSON.stringify(transport ?? null) },
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
