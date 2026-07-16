import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

// Dev parity with production: on a real board the UI is served from the SD card
// by RRF itself, so rr_ requests are same-origin. In dev we proxy them to a
// board. Default target is a local mock-duet (pnpm --filter @dwc-ng/mock-duet
// start); point at a real board without deploying by setting DWC_TARGET, e.g.
//   DWC_TARGET=http://duet3.nydick.net pnpm dev
// The proxy is server-side, so there is no CORS concern talking to the board.
const target = process.env.DWC_TARGET ?? 'http://127.0.0.1:8970'

// https://vite.dev/config/
export default defineConfig({
  plugins: [solid()],
  server: {
    proxy: {
      '^/rr_.*': { target, changeOrigin: true },
    },
  },
})
