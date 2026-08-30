/**
 * Argument-vector hygiene shared by the two mock-duet entry points
 * (`cli.ts` and `mockctl.ts`).
 *
 * WHY THIS EXISTS (GIT_172): `pnpm mock -- --port 8971` forwards the bare `--`
 * through to the script, and `node:util` `parseArgs` — which we run with the
 * default `allowPositionals: false` — rejects everything after it with
 * `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL`. On 2026-08-29 that killed a mock
 * start BEFORE it bound a socket, and the operator then "confirmed" the start
 * by curling the port, which was answered by an unrelated orphan. A separator
 * a package manager inserts is not an argument the program should see.
 */

/**
 * Drop bare `--` separators from an argument vector.
 *
 * Only the standalone token is dropped; `--foo`, `--foo=bar` and values that
 * merely start with a dash are untouched.
 */
export function stripArgSeparators(argv: readonly string[]): string[] {
	return argv.filter(arg => arg !== "--");
}
