/**
 * The app entry, and therefore the root of the EAGER bundle: everything
 * reachable from here by a static import is served on every board load.
 *
 * @invariant heavy-libraries-stay-behind-a-dynamic-import
 * @rung 4  static analysis — test/lazy-bundle.test.ts checks three things, and
 *          no two of them catch the same mistake. (1) Only editor/setup.ts,
 *          gcode/scene.ts and heightmap/surface3d.ts may name a heavy package
 *          at all. (2) Every module on the DYNAMIC_ONLY list — those three plus
 *          cards/ShapingCards.tsx, charts/DecayChart.tsx, shaping/resultsCodec.ts
 *          and compose/shapingService.ts — is reached only by `import type`
 *          (erased, since verbatimModuleSyntax is on) or `import(...)`; a value
 *          import of scene.ts pulls Babylon in exactly as a direct import
 *          would. (3) The transitive static-import closure of THIS file is
 *          walked, and the `src/shaping/**` modules it reaches must equal a
 *          committed list exactly — which is the only one of the three that
 *          catches a module nobody thought to name in advance
 * @why-3 (1) and (2) are per-FILE text matches, so they can only stop a
 *          regrowth someone predicted. Twice they did not: GIT_108 added
 *          shaping/selection.ts and GIT_51 added shaping/preconditions.ts to
 *          compose/services.ts, each a one-line import in a module that was
 *          already eager, and between them they put 23 modules of
 *          `src/shaping/**` — 21,635 B minified — on every board load and made
 *          the uat branch undeployable (#126). The graph walk makes LAZY the default for
 *          a new shaping module and a place on the critical path a diff
 * @why CLAUDE.md's first hard constraint is that the board's HTTP server is
 *      weak and payload is expensive. Babylon is 232 KB gzipped — larger than
 *      the whole eager bundle — CodeMirror is comparable, and the eight
 *      shaping bodies were 32,589 B of a 483,328 B ceiling (measured
 *      2026-08-23) for a screen that tunes a machine rather than runs one. The
 *      failure is silent in the worst way: one static import adds all of it
 *      back to what every load must serve, the app behaves identically on a
 *      dev machine, and the cost appears only as a slower first paint on
 *      hardware nobody profiles
 * @debt the owner set is a hand-maintained allowlist, which is debt by this
 *       project's own rule — a fifth lazy surface has to be added by name.
 *       It is the honest shape though: which boundaries are dynamic is a
 *       design decision, not something derivable from source. Promote by
 *       asserting against the BUILT chunk graph instead — the eager entry
 *       chunk must not reference a lazy chunk — which measures the thing the
 *       constraint is actually about rather than a proxy for it.
 */
import { render } from 'solid-js/web'
import './index.css'
import './theme-graphite.css'
import App from './App.tsx'
import { probeTransport } from '@dwc-ng/connector'
import { initialBackend, pinnedTransport } from './dev/backend.ts'
import { applyStoredScale } from './shell/scale.ts'
import { applyStoredTheme } from './shell/theme.ts'

const root = document.getElementById('app')!

// Before ANY render, and before the awaited transport probe below: the scale
// attribute drives CSS custom properties, so applying it after first paint
// would show one frame at the default spacing and then reflow the whole page.
applyStoredScale()
// Same reasoning for the theme: one frame of vellum before graphite is a flash.
applyStoredTheme()

// Palette lab (dev-only): repaints the chrome from a floating switcher so a
// palette can be judged against real machine data. Same before-first-paint
// reasoning as applyStoredScale above — it sets attributes that drive CSS
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
