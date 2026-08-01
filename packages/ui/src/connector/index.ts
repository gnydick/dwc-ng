/**
 * The connector module's public face.
 *
 * @invariant raw-transport-fence
 * @rung 3  a test — test/no-raw-transport.test.ts walks src and fails on any
 *          `fetch(`/XMLHttpRequest outside src/connector/, naming file and line.
 *          Declared here rather than on the test because the test file is not
 *          scanned: a declaration belongs at the boundary it protects
 * @why board traffic that bypasses the connector also bypasses the session
 *      handling, the 503 retry ladder, the request queue and the dev write
 *      guard — every one of which exists because the board's HTTP server is
 *      weak enough to fall over without them
 * @debt a test reports the violation after it is written. Promote by moving
 *       this module into its own workspace package, then shadowing the global
 *       in @dwc-ng/ui with a `globals.d.ts` declaring `fetch: never`, so a raw
 *       call outside the connector package stops compiling. Rung 7, and no new
 *       dependency — the alternative, ESLint, is one.
 */
export * from "./types.ts";
export { PollConnector, type PollConnectorOptions } from "./PollConnector.ts";
export { DsfConnector, type DsfConnectorOptions } from "./DsfConnector.ts";
export { createConnector, probeTransport, type Transport, type ConnectorTarget } from "./createConnector.ts";
