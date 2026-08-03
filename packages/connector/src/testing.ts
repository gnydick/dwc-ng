/**
 * The concrete dialects, for tests only.
 *
 * A test that drives one dialect against mock-duet is doing something the app
 * must never do: choosing a transport directly rather than letting
 * createConnector decide. That is legitimate — it is exercising a dialect, not
 * running a session — but it needs a door, and the door should be obvious.
 *
 * So it is a separate entry point rather than a widening of the package's main
 * one. `@dwc-ng/connector` exports no concrete class; `@dwc-ng/connector/testing`
 * does. An import of this path in application code is visible in one grep and
 * is rejected by test/sole-construction.test.ts, which is the point — the
 * boundary stays a boundary, and the exception is named instead of assumed.
 */
export { PollConnector, type PollConnectorOptions } from "./PollConnector.ts";
export { DsfConnector, type DsfConnectorOptions } from "./DsfConnector.ts";
