/**
 * The heavy libraries must not reach the eager bundle.
 *
 * CLAUDE.md's first hard constraint is that RRF's embedded HTTP server is weak
 * and payload is expensive. Babylon alone is 232 KB gzipped — larger than the
 * entire eager bundle — and CodeMirror is comparable. Both are kept out by
 * being reachable ONLY through a dynamic import(), which is a property of how
 * three specific files are imported, and nothing enforced it.
 *
 * The failure is silent in the worst way: a static import somewhere adds a
 * quarter-megabyte to what every board load must serve, the app still works
 * perfectly on a dev machine, and the cost shows up as a slower first paint on
 * hardware nobody profiles.
 *
 * Two halves, because either alone is insufficient:
 *  1. only the three owner modules may name the heavy packages at all;
 *  2. every module on DYNAMIC_ONLY may only be imported as `import type`
 *     (erased, since verbatimModuleSyntax is on) or via `import(...)`. A value
 *     import of scene.ts pulls Babylon in just as surely as importing Babylon
 *     directly.
 *
 * The second half covers more than the heavy-library owners. Our OWN code can
 * be the payload: the Shaping Lab's eight card bodies and the decay chart were
 * 32,589 B of the 483,328 B eager ceiling on 2026-08-23 — for a screen an
 * operator opens to tune a machine, not to run one. They are behind one
 * dynamic import in compose/cards.tsx, and one static import from anywhere
 * would put every byte back with nothing to show for it. Same failure mode,
 * same fence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/**
 * The modules allowed to name a heavy package. An allowlist is debt (a fourth
 * lazy surface has to be added by hand), and it is the honest shape here: the
 * set of dynamic-import boundaries is a design decision, not something derivable
 * from the source. Adding a name is the deliberate act the list exists to make.
 */
const LAZY_OWNERS = ["editor/setup.ts", "gcode/scene.ts", "heightmap/surface3d.ts"];
const HEAVY = /"(codemirror|@codemirror\/|@babylonjs\/|@lezer\/)/;

/**
 * Every module that may only be reached through a dynamic import: the heavy-
 * library owners above, plus our own code that is too big to serve on every
 * board load.
 *
 * `cards/ShapingCards.tsx` is the Shaping Lab's eight bodies and drags the
 * decay chart, the chart's data module and the FFT with it;
 * `charts/DecayChart.tsx` is named separately so it cannot be re-imported
 * eagerly by some future card while ShapingCards stays lazy. Both are reached
 * only from compose/cards.tsx, via `lazy(() => import(...))`.
 *
 * Adding a name is the deliberate act this list exists to make — see the
 * ledger row on the invariant (`heavy-libraries-stay-behind-a-dynamic-import`,
 * declared on src/main.tsx).
 */
const DYNAMIC_ONLY = [...LAZY_OWNERS, "cards/ShapingCards.tsx", "charts/DecayChart.tsx"];

function sourceFiles(): string[] {
	const out: string[] = [];
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const full = join(dir, name);
			if (statSync(full).isDirectory()) walk(full);
			else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
		}
	};
	walk(SRC);
	return out;
}

const rel = (f: string): string => relative(SRC, f).replaceAll("\\", "/");

test("only the lazy-loaded owners name a heavy package", () => {
	const offenders: string[] = [];
	for (const file of sourceFiles()) {
		if (LAZY_OWNERS.includes(rel(file))) continue;
		readFileSync(file, "utf8").split("\n").forEach((line, i) => {
			if (/^\s*import\b/.test(line) && HEAVY.test(line)) offenders.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
		});
	}
	assert.deepEqual(offenders, [], `these would pull a lazy library into the eager bundle:\n${offenders.join("\n")}`);
});

test("a dynamic-only module is only ever type-imported or dynamically imported", () => {
	const offenders: string[] = [];
	for (const file of sourceFiles()) {
		const self = rel(file);
		if (DYNAMIC_ONLY.includes(self)) continue;
		readFileSync(file, "utf8").split("\n").forEach((line, i) => {
			for (const owner of DYNAMIC_ONLY) {
				const base = owner.slice(owner.lastIndexOf("/") + 1);
				if (!line.includes(base)) continue;
				// `import type {...}` is erased; `await import("./scene.ts")` is the
				// dynamic form. A bare `import {...} from "./scene.ts"` is neither.
				if (/^\s*import\s+type\b/.test(line) || /\bimport\s*\(/.test(line)) continue;
				if (/^\s*import\b/.test(line)) offenders.push(`${self}:${i + 1}  ${line.trim()}`);
			}
		});
	}
	assert.deepEqual(offenders, [], `a value import defeats the dynamic boundary:\n${offenders.join("\n")}`);
});

test("the fence would actually catch a static import of the shaping bodies", () => {
	// The red check. A test that only ever passes proves nothing about whether
	// it can fail, and this one is a regex over source text — the failure mode
	// is a pattern that quietly matches nothing. So run the same rule over a
	// line that IS the mistake, and over the two forms that are not.
	const judge = (line: string): boolean => {
		if (/^\s*import\s+type\b/.test(line) || /\bimport\s*\(/.test(line)) return false;
		return /^\s*import\b/.test(line) && DYNAMIC_ONLY.some(o => line.includes(o.slice(o.lastIndexOf("/") + 1)));
	};
	assert.equal(judge('import { ShapingDecayBody } from "../cards/ShapingCards.tsx";'), true);
	assert.equal(judge('import { DecayChart } from "../charts/DecayChart.tsx";'), true);
	assert.equal(judge('import type { DecayChart } from "../charts/DecayChart.tsx";'), false);
	assert.equal(judge('const m = await import("../cards/ShapingCards.tsx");'), false);
});

test("the shaping bodies really are behind a dynamic import in the registry", () => {
	// The other direction: the fence above says nobody imports them statically,
	// which is also true of a module nobody imports at all. This says the ONE
	// place that renders them reaches them through `import(`, so the registry
	// cannot quietly stop offering the cards and still pass.
	const registry = readFileSync(join(SRC, "compose", "cards.tsx"), "utf8");
	assert.match(registry, /lazy\(\s*async\s*\(\)\s*=>[\s\S]{0,200}?import\("\.\.\/cards\/ShapingCards\.tsx"\)/);
	for (const body of [
		"ShapingStatusBody", "ShapingCaptureBody", "ShapingDecayBody", "ShapingSweepBody",
		"ShapingCandidatesBody", "ShapingCustomBody", "ShapingVerifyBody", "ShapingApplyBody",
	]) {
		assert.match(registry, new RegExp(`lazyShaping\\("${body}"\\)`), body);
	}
	// And the Settings card is deliberately NOT lazy: it is small and lives on
	// a screen the operator uses constantly.
	assert.match(registry, /"settings-shaping": \{ body: \(\) => <ShapingBody \/>/);
});
