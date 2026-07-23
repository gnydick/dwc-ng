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

// https://vite.dev/config/
export default defineConfig({
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
