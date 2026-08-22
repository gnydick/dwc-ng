/**
 * The app entry, and therefore the root of the EAGER bundle: everything
 * reachable from here by a static import is served on every board load.
 *
 * @invariant heavy-libraries-stay-behind-a-dynamic-import
 * @rung 4  static analysis — test/lazy-bundle.test.ts walks src and checks
 *          both halves: that only editor/setup.ts, gcode/scene.ts and
 *          heightmap/surface3d.ts name a heavy package at all, and that those
 *          three are reached only by `import type` (erased, since
 *          verbatimModuleSyntax is on) or `import(...)`. A value import of
 *          scene.ts pulls Babylon in exactly as a direct import would, which
 *          is why one check is not enough
 * @why CLAUDE.md's first hard constraint is that the board's HTTP server is
 *      weak and payload is expensive. Babylon is 232 KB gzipped — larger than
 *      the whole eager bundle — and CodeMirror is comparable. The failure is
 *      silent in the worst way: one static import adds a quarter-megabyte to
 *      what every load must serve, the app behaves identically on a dev
 *      machine, and the cost appears only as a slower first paint on hardware
 *      nobody profiles
 * @debt the owner set is a hand-maintained allowlist, which is debt by this
 *       project's own rule — a fourth lazy surface has to be added by name.
 *       It is the honest shape though: which boundaries are dynamic is a
 *       design decision, not something derivable from source. Promote by
 *       asserting against the BUILT chunk graph instead — the eager entry
 *       chunk must not reference a lazy vendor chunk — which measures the
 *       thing the constraint is actually about rather than a proxy for it.
 */
import { render } from 'solid-js/web'
import './index.css'
import App from './App.tsx'
import { probeTransport } from '@dwc-ng/connector'
import { initialBackend, pinnedTransport } from './dev/backend.ts'
import { applyStoredScale } from './shell/scale.ts'

const root = document.getElementById('app')!

// Before ANY render, and before the awaited transport probe below: the scale
// attribute drives CSS custom properties, so applying it after first paint
// would show one frame at the default spacing and then reflow the whole page.
applyStoredScale()

// Palette lab (dev-only): repaints the chrome from a floating switcher so a
// palette can be judged against real machine data. Same before-first-paint
// reasoning as applyStoredPitch above — it sets attributes that drive CSS
// custom properties, so applying it later would show one frame of the shipped
// palette and then repaint.
//
// Dynamic, inside the guard, on purpose: Vite substitutes import.meta.env.DEV
// to false for a board build and Rollup then drops this branch, so neither the
// module nor its stylesheet reaches the bundle the printer serves. A static
// import would ship both.
if (import.meta.env.DEV) {
  const { startPaletteLab } = await import('./dev/paletteLab.ts')
  startPaletteLab()
}

// The dialect has to be known BEFORE App runs: the connector is constructed in
// App's body and a session may never re-point it (C14), so there is no "detect
// later and switch" — that is exactly the half-switched state the design
// forbids. Hence resolving it here, then rendering.
//
// A production bundle needs no configuration for this. It is served by the
// printer, so it is same-origin; there is no target to name and no way to know
// what someone calls their machine. If the build pinned a dialect
// (DWC_TRANSPORT, which packages/deploy can set because it knows the target)
// that is used as-is; otherwise the board is asked. The probe is not a guess:
// /machine/status existing IS the DSF signature, and its absence IS the
// standalone signature.
const pinned = pinnedTransport()
const transport = pinned ?? await probeTransport('')
render(() => <App backend={initialBackend(transport)} />, root)
