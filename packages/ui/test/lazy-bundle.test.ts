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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
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
 * `shaping/resultsCodec.ts` is here for a subtler version of the same failure.
 * It was part of shaping/results.ts, which the EAGER service registry imports
 * for `emptyResults`, `RESULTS_PATH` and `fingerprintOf` — so ~3 KB of
 * hostile-input JSON validation, run twice per tool per session behind an
 * awaited round trip to the board, was on the critical path of every cold load
 * (measured 2026-08-24: it was what put the eager payload 579 B over its
 * ceiling). It is reached only from shaping/store.ts's `load` and `save`, via
 * `import(...)`. Nothing stops a future edit from importing `parseResults`
 * statically "just for a type guard" and quietly putting it all back, which is
 * precisely what this list is.
 *
 * Adding a name is the deliberate act this list exists to make — see the
 * ledger row on the invariant (`heavy-libraries-stay-behind-a-dynamic-import`,
 * declared on src/main.tsx).
 */
const DYNAMIC_ONLY = [
	...LAZY_OWNERS,
	"cards/ShapingCards.tsx",
	"charts/DecayChart.tsx",
	"shaping/resultsCodec.ts",
	// The Lab's SERVICE (#126). It is the reason the other three entries stopped
	// being enough: `compose/services.ts` is eager and imported it at module
	// scope, so the eight bodies arrived in their own chunk while every module
	// they need was already on the critical path. It is reached the same way the
	// bodies are — `compose/cards.tsx`'s `loadShapingLab` resolves both in one
	// promise — and `compose/shapingSlot.ts` is the erased-type seam that lets
	// the eager registry stay typed without a runtime edge to it.
	"compose/shapingService.ts",
];

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
	assert.equal(judge('import { parseResults } from "./resultsCodec.ts";'), true);
	assert.equal(judge('const { parseResults } = await import("./resultsCodec.ts");'), false);
	// And the entry added for #126 — the regrowth this whole section exists for
	// was a static import into an eager module, spelled exactly like this.
	assert.equal(judge('import { shapingService } from "./shapingService.ts";'), true);
	assert.equal(judge('import type { BatchPurpose } from "../compose/shapingService.ts";'), false);
	assert.equal(judge('const { shapingService } = await import("./shapingService.ts");'), false);
});

test("the results codec really is behind a dynamic import in the store", () => {
	// Same second direction as the registry check below: "nobody imports it
	// statically" is also true of a module nobody imports at all, and a codec
	// nothing reaches is a results file nothing can read. The store is the sole
	// route to it — see the results-persist-through-one-writer invariant — so
	// this pins that route to the dynamic form.
	const store = readFileSync(join(SRC, "shaping", "store.ts"), "utf8");
	assert.match(store, /import\("\.\/resultsCodec\.ts"\)/);
	// And that BOTH halves of the round trip go through it, not just the read.
	assert.match(store, /\bparseResults\b/);
	assert.match(store, /\bserializeResults\b/);
});

test("the shaping bodies really are behind a dynamic import in the registry", () => {
	// The other direction: the fence above says nobody imports them statically,
	// which is also true of a module nobody imports at all. This says the ONE
	// place that renders them reaches them through `import(`, so the registry
	// cannot quietly stop offering the cards and still pass.
	const registry = readFileSync(join(SRC, "compose", "cards.tsx"), "utf8");
	assert.match(registry, /lazy\(\s*async\s*\(\)\s*=>[\s\S]{0,200}?loadShapingLab\(\)/);
	// And that the loader FILLS THE SLOT before it returns. This is the ordering
	// `compose/shapingSlot.ts` depends on: `SERVICES.shaping` reads a factory
	// only this function writes, so a loader that returned a component without
	// writing it would leave every Lab card throwing on first navigation — while
	// every other test in this file still passed.
	const loader = /async function loadShapingLab[\s\S]{0,600}?\n}/.exec(registry)?.[0] ?? "";
	assert.match(loader, /await import\("\.\.\/cards\/ShapingCards\.tsx"\)/, "the loader awaits the chunk");
	assert.match(loader, /provideShapingService\(/, "and provides the factory before returning");
	// One chunk for the whole Lab, which is why the service is re-exported by the
	// bodies' module rather than imported separately: two specifiers would be two
	// requests on a server this project's first constraint is about.
	const cards = readFileSync(join(SRC, "cards", "ShapingCards.tsx"), "utf8");
	assert.match(cards, /^export \{ shapingService \} from "\.\.\/compose\/shapingService\.ts";$/m,
		"ShapingCards.tsx must re-export shapingService by VALUE, or the loader cannot hand it over and the Lab splits into a second chunk");
	for (const body of [
		"ShapingStatusBody", "ShapingCaptureBody", "ShapingDecayBody", "ShapingSweepBody",
		"ShapingCandidatesBody", "ShapingCustomBody", "ShapingVerifyBody", "ShapingApplyBody",
	]) {
		assert.match(registry, new RegExp(`lazyShaping\\("${body}"\\)`), body);
	}
	// And the Settings card is deliberately NOT lazy: it is small and lives on
	// a screen the operator uses constantly. Asserted as the PROPERTY rather
	// than as one spelling of the line — it used to pin `body: () =>`, which
	// broke the day the card started taking a ctx to reach the shaping service,
	// without anything about its eagerness having changed.
	const settingsLine = registry.split(/\r?\n/).find(l => l.includes('"settings-shaping":'));
	assert.ok(settingsLine !== undefined, "the Settings card must still be registered");
	assert.match(settingsLine, /<ShapingBody[\s/]/, "and must render ShapingBody");
	assert.doesNotMatch(settingsLine, /lazyShaping|lazy\(|import\(/, "it is deliberately eager");
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE EAGER IMPORT GRAPH, and the one subsystem that must stay out of it.
 *
 * Everything above matches TEXT, per file. That catches a regrowth somebody
 * already thought to name — and both of the regrowths this section exists
 * because of were files nobody had named:
 *
 *   GIT_108 (5640d6c) added `shaping/selection.ts`     to compose/services.ts
 *   GIT_51  (b169582) added `shaping/preconditions.ts` to compose/services.ts
 *
 * Each was a one-line import in a module that was ALREADY eager, so no rule
 * here fired, and between them they put 23 modules of `src/shaping/**` —
 * 189,970 source bytes, 21,635 B minified — on the critical path of every cold
 * load. `cards/ShapingCards.tsx` was lazy the whole time. The SERVICE defeated
 * it behind its back, which is exactly what packages/deploy/eager-budget.json's
 * standing note says to look for and exactly what it had already been fixed
 * for once (#126).
 *
 * So this walks the graph instead of the text: static, value-carrying imports
 * from src/main.tsx, stopping at every `import(`. What it reaches IS the eager
 * bundle. The set of `shaping/**` modules in it must equal EAGER_SHAPING
 * exactly — a ratchet, in the same shape as debt-ceiling.json:
 *
 *  - a new shaping module defaults to LAZY. Putting one on the critical path
 *    means adding it here by name, which is a diff and a decision;
 *  - a tendril grown three hops away (config/store.ts → … → selection.ts)
 *    fails too, because the walk is transitive and the text checks are not;
 *  - removing an entry that is no longer eager is also required, so the list
 *    cannot rot into a set of stale permissions nobody re-examines.
 *
 * The claim this enforces is declared on src/main.tsx, the root of the eager
 * bundle, alongside the DYNAMIC_ONLY half — one declaration for one property,
 * where the generator can see it. This is a test, so the rung is 4: nothing in
 * the language stops the import being written; the suite goes red when it is.
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * `shaping/**` modules an EAGER module is allowed to reach, and why each one
 * has to be here rather than behind the boundary.
 *
 * Every entry is a permission granted to the critical path. Keep it justified
 * or delete it.
 */
const EAGER_SHAPING = [
	// The Settings › Input shaping card. It is deliberately NOT lazy (see
	// compose/cards.tsx) — it is small and lives on a screen the operator uses
	// constantly — so what IT needs is legitimately eager.
	"shaping/accelPresence.ts",   // accelerometerOf: is this tool's sensor there?
	"shaping/accelReport.ts",     // what M955 said the rate and resolution are
	"shaping/motionFields.ts",    // the excitation-move fields it edits
	"shaping/settingsDraft.ts",   // and the draft/commit rules for them
	// control/commands.ts is the sole minting site for every G-code string the
	// app sends, so it is eager by definition; `cmd.inputShaping` needs the
	// shaper spec and its units.
	"shaping/engine/shapers.ts",
	"shaping/engine/units.ts",
];

/** Static, value-carrying relative imports out of one module. */
function staticImportsOf(file: string): string[] {
	// Block comments stripped first: this file's own prose quotes import lines,
	// and a commented-out import is not an edge.
	const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	const specs: string[] = [];
	// `import type` / `export type` are erased (verbatimModuleSyntax), so they
	// are not edges. `import(` never matches: the pattern requires `from`
	// AFTER the clause, which a dynamic import has no room for.
	const withClause = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[\s\S]*?from\s*["']([^"']+)["']/g;
	// And the side-effect form, which has no clause at all.
	const bare = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
	for (const re of [withClause, bare]) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(src)) !== null) if (m[1]!.startsWith(".")) specs.push(m[1]!);
	}
	return specs;
}

function resolveImport(fromFile: string, spec: string): string | null {
	const base = resolve(dirname(fromFile), spec);
	for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
		if ((c.endsWith(".ts") || c.endsWith(".tsx")) && existsSync(c)) return c;
	}
	// A .css or an unresolvable specifier is not a module in this graph.
	return null;
}

/** Every module a cold load must have: the transitive static closure of main.tsx. */
function eagerGraph(): string[] {
	const seen = new Set<string>();
	const stack = [join(SRC, "main.tsx")];
	while (stack.length > 0) {
		const file = stack.pop()!;
		if (seen.has(file)) continue;
		seen.add(file);
		for (const spec of staticImportsOf(file)) {
			const r = resolveImport(file, spec);
			if (r !== null && !seen.has(r)) stack.push(r);
		}
	}
	return [...seen].map(rel).sort();
}

test("the eager graph reaches only the shaping modules named as eager", () => {
	const reached = eagerGraph().filter(f => f.startsWith("shaping/"));
	assert.deepEqual(
		reached,
		[...EAGER_SHAPING].sort(),
		"a shaping module reached the critical path.\n" +
			"Either put it behind the dynamic boundary (compose/cards.tsx's lazyShaping,\n" +
			"which is how the Lab's service and bodies get there), or add it to\n" +
			"EAGER_SHAPING above with the reason it has to be served on every board load.",
	);
});

test("the graph walk can see an edge, and stops at a dynamic one", () => {
	// The red check. This walk is the only thing standing between the Shaping
	// Lab and the critical path, and its failure mode is finding nothing at all
	// — a regex that quietly matches no imports would report a perfectly empty
	// eager graph and pass forever. So prove both directions on real files.
	const g = eagerGraph();
	assert.ok(g.length > 100, `the walk found only ${g.length} modules — it is not following imports`);
	assert.ok(g.includes("compose/services.ts"), "main.tsx does reach the service registry");
	assert.ok(g.includes("compose/cards.tsx"), "and the card registry");
	// And the boundary itself: cards.tsx names ShapingCards.tsx, but only
	// inside `import(`, so the walk must NOT cross into it.
	assert.match(readFileSync(join(SRC, "compose", "cards.tsx"), "utf8"), /import\("\.\.\/cards\/ShapingCards\.tsx"\)/);
	assert.ok(!g.includes("cards/ShapingCards.tsx"), "the Lab's bodies are behind a dynamic import");
});

test("no eager module builds the Lab's service synchronously", () => {
	// The other half of the slot's guarantee (compose/shapingSlot.ts). Keeping
	// `shaping/**` out of the eager graph stops the BYTES arriving; this stops
	// the eager graph asking for a service that cannot exist yet. Every legal
	// caller is inside the Lab's own chunk, which cannot render before
	// `loadShapingLab` has resolved the factory — so an eager caller is either a
	// throw on first navigation or a card that has to await the chunk itself.
	//
	// One exception, and it must SAY so on the line: `compose/cards.tsx`'s
	// Reload action. The card chrome is eager and on screen before the body's
	// chunk lands, so the click goes through `loadShapingLab()` first.
	const offenders: string[] = [];
	for (const module of eagerGraph()) {
		readFileSync(join(SRC, module), "utf8").split("\n").forEach((line, i) => {
			if (!line.includes('service("shaping")')) return;
			// Prose, not code: every file here explains itself, and shapingSlot.ts
			// quotes the very call it exists to guard.
			if (/^\s*(?:\*|\/\/)/.test(line)) return;
			if (line.includes("loadShapingLab")) return;
			offenders.push(`${module}:${i + 1}  ${line.trim()}`);
		});
	}
	assert.deepEqual(
		offenders,
		[],
		"an eager module reaches ctx.service(\"shaping\") without awaiting the Lab's chunk:\n" +
			`${offenders.join("\n")}\n` +
			"Move the call into a lazily-loaded body, or route it through loadShapingLab().",
	);
});

test("the eager-caller rule would catch the mistake it is here for", () => {
	// Red check, same reason as the one above it: this rule is a substring
	// search, and a substring search whose subject is never present passes
	// forever. Judge the three forms directly.
	const judge = (line: string): boolean =>
		line.includes('service("shaping")') && !/^\s*(?:\*|\/\/)/.test(line) && !line.includes("loadShapingLab");
	assert.equal(judge('\tconst svc = props.ctx.service("shaping");'), true, "the mistake");
	assert.equal(judge('\t\tonClick={() => void loadShapingLab().then(() => ctx.service("shaping").reload())}'), false, "the awaited form");
	assert.equal(judge('\t * reachable only from `ctx.service("shaping")`, whose every call site'), false, "prose");
});
