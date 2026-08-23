/**
 * The connector module's public face.
 *
 * @invariant raw-transport-fence
 * @rung 4  static analysis over a package boundary. Board traffic can only be
 *          issued from THIS package now — @dwc-ng/ui declares no transport of
 *          its own and cannot name a connector class, so the interesting
 *          violation (traffic that skips the session handling, the 503 ladder,
 *          the queue and the dev write guard) is no longer expressible there.
 *          What a raw `fetch` in ui could still do is talk to something that is
 *          not the board, and test/no-raw-transport.test.ts is what catches
 *          that, by file and line
 * @why board traffic that bypasses the connector also bypasses the session
 *      handling, the 503 retry ladder, the request queue and the dev write
 *      guard — every one of which exists because the board's HTTP server is
 *      weak enough to fall over without them
 * @debt MEASURED 2026-08-02, and the previously filed promotion does not work.
 *       It said: move the connector into its own package, then shadow the
 *       global in @dwc-ng/ui with a d.ts declaring `fetch: never`, for rung 7.
 *       The package move is done. The shadow is not achievable: a global
 *       `declare const fetch: never` does not override lib.dom's declaration —
 *       tested directly, a `fetch(...)` call beside it compiles clean, and
 *       skipLibCheck hides the duplicate-identifier conflict that would
 *       otherwise be raised against the DECLARATION rather than against uses.
 *       Making it work needs either dropping "DOM" from ui's lib and
 *       re-declaring what the app actually uses, which is a large and fragile
 *       surface, or a lint rule — and the linter is a dependency, which is
 *       Gabe's call under the dependency policy rather than mine. Filed rather
 *       than guessed at: the scan stays, and it now guards a much smaller gap.
 */
/**
 * The concrete connectors are NOT re-exported. createConnector is the only way
 * to obtain one, so a second construction site cannot be written against this
 * module's public face — see connector/sole-construction.
 *
 * Removing them cost nothing, which is worth recording: the re-export had zero
 * consumers. Every test imports PollConnector straight from ./PollConnector.ts,
 * and App.tsx takes only createConnector. The promotion note on
 * createConnector.ts had claimed the tests blocked this; they never used this
 * route at all.
 */
export * from "./types.ts";
export { createConnector, probeTransport, type Transport, type ConnectorTarget } from "./createConnector.ts";
export type { Layer } from "./layerHistory.ts";
export { isPlainObject, isSafeKey, safeEntries } from "./safeObject.ts";
export { EMERGENCY_STOP, isEmergencyStop } from "./emergency.ts";
export { createStubConnector } from "./stubConnector.ts";
/**
 * The clock seam's types only. `realClock` is deliberately NOT on this face:
 * it is the default the connectors already apply, so an app never needs to
 * name it, and a second construction of "now" is exactly what the seam exists
 * to prevent.
 */
export type { Clock, TimerHandle } from "./clock.ts";
