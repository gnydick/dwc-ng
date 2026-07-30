/**
 * Which build this bundle IS, stamped at compile time.
 *
 * A Duet board serves the entry document with
 * `cache-control: public,max-age=3600,must-revalidate`, so for an hour after a
 * deploy an already-open tab keeps its old `<script src>` — and the hashed
 * assets it names are still in that browser's cache even after the deploy has
 * pruned them from the board. The result is a tab quietly running an older
 * bundle while every other signal says the deploy succeeded, and the same code
 * appearing to behave differently in two places.
 *
 * That cost most of an afternoon to chase, twice, so the answer is now on
 * screen: the rail footer shows this, and the deploy prints the same value.
 * If they differ, the tab is stale — reload it before believing anything else
 * about the difference.
 *
 * Vite substitutes __BUILD_ID__ literally at build time (see vite.config.ts).
 * The `typeof` guard keeps this working under the test runner and any tool
 * that imports the module without Vite's define in place.
 */
declare const __BUILD_ID__: string | undefined;

export const BUILD_ID: string =
	typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
