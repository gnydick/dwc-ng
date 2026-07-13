import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

// https://vite.dev/config/
export default defineConfig({
  plugins: [solid()],
  server: {
    // Dev parity with production: on a real board the UI is served from the
    // SD card by RRF itself, so rr_ requests are same-origin. In dev, proxy
    // them to a running mock-duet (pnpm --filter @dwc-ng/mock-duet start).
    proxy: {
      '^/rr_.*': 'http://127.0.0.1:8970',
    },
  },
})
