import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

// Dev parity with production: on a real board the UI is served from the SD card
// by RRF itself, so rr_ requests are same-origin. In dev we proxy them to a
// board. Default target is a local mock-duet (pnpm --filter @dwc-ng/mock-duet
// start); point at a real board without deploying by setting DWC_TARGET, e.g.
//   DWC_TARGET=http://duet3.nydick.net pnpm dev
// The proxy is server-side, so there is no CORS concern talking to the board.
const target = process.env.DWC_TARGET ?? 'http://127.0.0.1:8970'
const realTarget = process.env.DWC_REAL ?? 'http://duet3.nydick.net'

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
export default defineConfig({
  base,
  // The declared transport, frozen into the bundle. Vite substitutes it
  // literally, so the branch that does not apply is dead code the minifier
  // removes — a bundle built for one dialect does not carry the other's
  // decision at all.
  define: { __DWC_TRANSPORT__: JSON.stringify(transport ?? 'rr') },
  plugins: [solid()],
  server: {
    host: true, // listen on all interfaces, not just localhost — lets other devices on the LAN reach the dev server
    allowedHosts: ['bighoss'], // Vite's DNS-rebinding guard rejects any Host header not on this list — LAN devices reach us by hostname
    proxy: {
      // In-UI Mock/Real toggle (dev only): the connector prefixes requests with
      // "/real" to reach the real board, "" for the mock. Both are proxied
      // server-side so the browser never hits the board directly (no CORS).
      '^/real/rr_.*': { target: realTarget, changeOrigin: true, rewrite: p => p.replace(/^\/real/, '') },
      '^/rr_.*': { target, changeOrigin: true },
      // DSF's whole surface, HTTP and WebSocket, in ONE entry per backend:
      // the REST routes (/machine/file, /machine/code, … and the rr_
      // connector's layer-history enrichment GET /machine/model) and the bare
      // `/machine` WebSocket endpoint, which carries `?sessionKey=…`. The
      // pattern is deliberately unanchored at the end — an anchored `$` cannot
      // match the query string, and a `/.*` form cannot match the bare
      // endpoint at all. ws:true is required for Vite to proxy the Upgrade.
      '^/real/machine': { target: realTarget, changeOrigin: true, ws: true, rewrite: p => p.replace(/^\/real/, '') },
      '^/machine': { target, changeOrigin: true, ws: true },
    },
  },
})
