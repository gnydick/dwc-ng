/**
 * What every cold load of the app costs, and the committed ceiling on it.
 *
 * CLAUDE.md's first hard constraint is payload: RRF's embedded server is weak
 * and requests are expensive. Every other constraint in this repo that matters
 * got a ratchet — the debt ceiling, the red-flag count, register drift — and
 * each is caught in the diff that causes it. This one had none, and the cost
 * of that was measurable: eager payload grew 26% (96.9 KB gz on 2026-07-24 to
 * 122.4 KB gz on 2026-08-03) without any commit reporting it, because it
 * arrived one card at a time in increments no single change would flag.
 *
 * Measured RAW, not gzipped, because raw is what this machine actually pays.
 * DSF's Kestrel neither compresses on the fly nor serves .gz (verified on
 * hardware 2026-07-24 — see deploy/compression-follows-the-server), so a cold
 * load over DSF downloads every one of these bytes uncompressed. A gzipped
 * figure would describe the standalone path while flattering the one in use.
 *
 * @invariant eager-payload-cannot-drift-upward
 * @rung 6  choke-point on the one path that puts bytes on a board — ship
 *          measures before it writes anything, on dry runs too, and refuses.
 *          The ceiling is committed, so raising it is a diff. Not a lint that
 *          can be skipped and not a number in a doc: the deploy either fits or
 *          does not happen
 * @why CLAUDE.md's first hard constraint is payload, and it was the only
 *      constraint here with no ratchet. Measured cost of that: eager grew 26%
 *      between 2026-07-24 and 2026-08-03 (96.9 -> 122.4 KB gz) with no commit
 *      reporting it, because it arrived one card at a time in increments no
 *      single change would flag. Over DSF the real figure is worse — Kestrel
 *      sends it uncompressed, so a cold load is 402 KB, not 122
 * @debt it gates the DEPLOY, which is late: the growth is already committed and
 *       possibly merged by then. Promote by measuring in CI on the build, so
 *       the diff that adds the weight is the one that fails. Blocked on there
 *       being no CI in this repo yet — which is worth stating plainly rather
 *       than filing as though a script would fix it.
 */
import { readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The assets `index.html` pulls in before the app can run: its entry script,
 * every modulepreload, every stylesheet.
 *
 * Deliberately NOT "everything in dist" — the lazy chunks are the whole point
 * of the dynamic-import boundary, and counting them would punish the split that
 * keeps Babylon and CodeMirror out of this number. What lands here is what the
 * browser must have in hand to paint.
 */
export function eagerAssets(indexHtml: string): string[] {
	const found = new Set<string>()
	// One pattern over the attributes that cause an eager fetch. A <link> with
	// any other rel (icon, manifest) is not on the critical path.
	const tag = /<(?:script|link)\b[^>]*>/gi
	for (const [element] of indexHtml.matchAll(tag)) {
		const isScript = /^<script/i.test(element)
		const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(element)?.[1]?.toLowerCase()
		if (!isScript && rel !== "modulepreload" && rel !== "stylesheet") continue
		const url = /\b(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(element)?.[1]
		if (url !== undefined && url.startsWith("/")) found.add(url)
	}
	return [...found].sort()
}

export interface EagerMeasurement {
	readonly bytes: number
	readonly assets: ReadonlyArray<{ readonly url: string; readonly bytes: number }>
}

/** Sum the eager assets on disk. A referenced file that is missing throws — a
 *  budget computed over a partial build would under-report and pass. */
export function measureEager(distDir: string): EagerMeasurement {
	const html = readFileSync(join(distDir, "index.html"), "utf8")
	const assets = eagerAssets(html).map(url => ({
		url,
		bytes: statSync(join(distDir, url.replace(/^\//, ""))).size,
	}))
	return {
		bytes: assets.reduce((n, a) => n + a.bytes, 0) + Buffer.byteLength(html),
		assets,
	}
}

/**
 * The committed ceiling, in bytes.
 *
 * Stored as an explicit byte count rather than "401 KB", because KB and KiB
 * differ by 2.4% at this scale and a budget you have to convert is one you will
 * eventually convert wrongly.
 */
export function readEagerBudget(budgetFile?: string): number {
	// Resolved from this module rather than from a cwd, so the number is the
	// same whether ship runs from the repo root, a worktree, or a filter.
	const file = budgetFile ?? join(dirname(fileURLToPath(import.meta.url)), "..", "eager-budget.json")
	const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
	const bytes = (parsed as { maxEagerBytes?: unknown } | null)?.maxEagerBytes
	if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
		throw new Error(`eager-budget.json: "maxEagerBytes" must be a positive integer, got ${String(bytes)}`)
	}
	return bytes
}

/** Human-readable overrun report, or null when inside budget. */
export function overBudget(measured: EagerMeasurement, budget: number): string | null {
	if (measured.bytes <= budget) return null
	const worst = [...measured.assets].sort((a, b) => b.bytes - a.bytes).slice(0, 5)
	return [
		`eager payload ${measured.bytes.toLocaleString()} B exceeds the committed budget of ${budget.toLocaleString()} B`,
		`  by ${(measured.bytes - budget).toLocaleString()} B. This is what a cold load costs over DSF, uncompressed.`,
		`  largest eager assets:`,
		...worst.map(a => `    ${a.bytes.toLocaleString().padStart(9)} B  ${a.url}`),
		`  Either move something behind a dynamic import, or raise maxEagerBytes in`,
		`  packages/deploy/eager-budget.json — deliberately, in a commit that says why.`,
	].join("\n")
}
