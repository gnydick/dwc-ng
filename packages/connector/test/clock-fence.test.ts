/**
 * The clock fence (invariant `connector/clock-seam`, declared in src/clock.ts).
 *
 * Rule: nothing under `src/` may reach the platform's notion of time. Every
 * deferral goes through the injected `Clock`, and `src/clock.ts` is the one
 * module allowed to name `setTimeout` and friends.
 *
 * Why a fence and not just the compile-time shadow. The `declare const
 * setTimeout: never` prelude in each timer-owning module turns a raw call into
 * a compile error, which is the strongest rung available — but only in a file
 * that carries it. A file added tomorrow carries nothing, and that is exactly
 * the case that put 12.9 s of sleeping into a 15.1 s battery in the first
 * place. So the fence walks the whole tree, and it additionally checks the
 * prelude is still present in every module that owns a clock, so nobody can
 * delete the shadow on the way to adding a timer.
 *
 * Following `test/sole-construction.test.ts` and the UI's shaping motion
 * fence: the rule is a pure predicate over (path, source), so the red checks
 * below can feed it offending source that does not exist on disk and prove it
 * bites. A rule proven only by "the tree is clean today" is a fence around an
 * empty field.
 *
 * Known gap, named rather than left to be discovered: `PollConnector.xhrPost`
 * sets `xhr.timeout`, the XMLHttpRequest object's own budget. It is not a
 * scheduling call, there is no clock-driven substitute short of reimplementing
 * XHR, and the path is browser-only (Node has no XMLHttpRequest, so no test
 * reaches it). It is recorded as @debt on the invariant in src/clock.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** The one module allowed to name a platform timer. */
const SEAM = "clock.ts";

interface Rule {
	readonly name: string;
	readonly pattern: RegExp;
	readonly why: string;
}

/**
 * Each pattern is anchored so that the SEAM'd forms stay legal: a member
 * access (`this.clock.setTimeout(`, `clock.now()`) is excluded by requiring
 * that the identifier is not preceded by a dot.
 */
const RULES: readonly Rule[] = [
	{
		name: "platform scheduling call",
		pattern: /(^|[^.\w$])(setTimeout|setInterval|clearTimeout|clearInterval|setImmediate|queueMicrotask)\s*\(/,
		why: "a deferral that reaches the platform cannot be observed by a test without waiting it out",
	},
	{
		name: "typeof setTimeout",
		pattern: /\btypeof\s+(setTimeout|setInterval)\b/,
		why: "a timer handle is Clock's TimerHandle, not the platform's return type",
	},
	{
		name: "Date.now()",
		pattern: /(^|[^.\w$])Date\s*\.\s*now\s*\(/,
		why: "a deadline measured against wall time cannot be driven by a test",
	},
	{
		name: "new Date() with no argument",
		pattern: /new\s+Date\s*\(\s*\)/,
		why: "reading the wall clock is Clock.now(); `new Date(ms)` for formatting is fine",
	},
	{
		name: "performance.now()",
		pattern: /(^|[^.\w$])performance\s*\.\s*now\s*\(/,
		why: "same as Date.now(), with the same consequence for a test",
	},
	{
		name: "AbortSignal.timeout()",
		pattern: /(^|[^.\w$])AbortSignal\s*\.\s*timeout\s*\(/,
		why: "a request budget is a deferral too — leaving it on wall time is what made one silent-socket test cost 9 s",
	},
];

/** The shadow prelude, by the names it must declare. */
const SHADOWS = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "performance", "AbortSignal"] as const;

/**
 * Who must carry the prelude: any module that imports the default clock, i.e.
 * any module that owns deferred work. Derived from the source, never a
 * hand-maintained list (cant-break-by-design A5.10) — a new timer-owning
 * module needs `realClock` for its default and is caught automatically.
 */
function ownsAClock(text: string): boolean {
	return /import\s*\{[^}]*\brealClock\b[^}]*\}\s*from\s*"\.\/clock\.ts"/.test(text);
}

function isCommentary(line: string): boolean {
	const t = line.trimStart();
	return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/** A prelude line declares the shadow; it is the fix, not the offence. */
function isShadowDeclaration(line: string): boolean {
	return /^\s*declare\s+const\s+\w+\s*:\s*never\s*;/.test(line);
}

/** The rule, as a pure predicate over one file's path and text. */
function fenceViolations(rel: string, text: string): string[] {
	const out: string[] = [];
	if (rel === SEAM) return out;
	text.split("\n").forEach((line, i) => {
		if (isCommentary(line) || isShadowDeclaration(line)) return;
		for (const rule of RULES) {
			if (rule.pattern.test(line)) out.push(`${rel}:${i + 1}: ${rule.name} — ${line.trim()}`);
		}
	});
	if (ownsAClock(text)) {
		for (const name of SHADOWS) {
			const declared = new RegExp(`^\\s*declare\\s+const\\s+${name}\\s*:\\s*never\\s*;`, "m").test(text);
			if (!declared) out.push(`${rel}: owns a Clock but is missing the shadow \`declare const ${name}: never;\``);
		}
	}
	return out;
}

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
		else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
	}
	return out;
}

test("no file under connector/src reaches the platform clock", () => {
	const offenders: string[] = [];
	let scanned = 0;
	let owners = 0;
	for (const file of sourceFiles(SRC)) {
		scanned++;
		const rel = relative(SRC, file).replaceAll("\\", "/");
		const text = readFileSync(file, "utf8");
		if (rel !== SEAM && ownsAClock(text)) owners++;
		offenders.push(...fenceViolations(rel, text));
	}
	// A walk that found nothing would pass every rule vacuously.
	assert.ok(scanned >= 12, `expected the src tree to be walked, scanned ${scanned} files`);
	assert.ok(owners >= 2, `expected both connectors to own a clock, found ${owners}`);
	assert.deepEqual(offenders, [], `clock fence:\n${offenders.join("\n")}`);
});

test("the seam itself is where the platform timers live", () => {
	const seam = readFileSync(join(SRC, SEAM), "utf8");
	for (const name of ["setTimeout", "setInterval", "clearTimeout", "clearInterval"]) {
		assert.ok(seam.includes(`globalThis.${name}(`), `clock.ts must own globalThis.${name}`);
	}
	assert.ok(seam.includes("AbortSignal.timeout("), "clock.ts must own the request-budget signal");
	assert.ok(/now:\s*\(\)\s*=>\s*Date\.now\(\)/.test(seam), "clock.ts must own the wall-clock read");
});

// ---- red checks: prove the rule bites on source that is not on disk ----

test("red check: a raw scheduling call is rejected in any src file", () => {
	for (const rel of ["DsfConnector.ts", "PollConnector.ts", "somethingNew.ts", "nested/deep.ts"]) {
		const found = fenceViolations(rel, "\t\tthis.pingTimer = setInterval(() => this.ping(), 2000);\n");
		assert.equal(found.length, 1, `${rel} must be rejected, got ${JSON.stringify(found)}`);
		assert.match(found[0]!, /platform scheduling call/);
	}
	// …and the same call through the seam is fine.
	assert.deepEqual(fenceViolations("DsfConnector.ts", "\t\tthis.pingTimer = this.clock.setInterval(() => this.ping(), 2000);\n"), []);
});

test("red check: every banned form is caught, and its seam equivalent is not", () => {
	const cases: ReadonlyArray<readonly [string, string]> = [
		["\t\tconst t = setTimeout(fn, 10);\n", "\t\tconst t = this.clock.setTimeout(fn, 10);\n"],
		["\t\tclearTimeout(this.pollTimer);\n", "\t\tthis.clock.clearTimeout(this.pollTimer);\n"],
		["\t\tclearInterval(this.pingTimer);\n", "\t\tthis.clock.clearInterval(this.pingTimer);\n"],
		["\t\tsetImmediate(fn);\n", "\t\tthis.clock.setTimeout(fn, 0);\n"],
		["\tprivate t: ReturnType<typeof setTimeout> | null = null;\n", "\tprivate t: TimerHandle | null = null;\n"],
		["\t\tlet lastSeen = Date.now();\n", "\t\tlet lastSeen = this.clock.now();\n"],
		["\t\tconst stamp = new Date().toISOString();\n", "\t\tconst stamp = new Date(this.clock.now()).toISOString();\n"],
		["\t\tconst t0 = performance.now();\n", "\t\tconst t0 = this.clock.now();\n"],
		["\t\t\tsignal: AbortSignal.timeout(this.requestTimeoutMs),\n", "\t\t\tsignal: this.clock.timeoutSignal(this.requestTimeoutMs),\n"],
	];
	for (const [bad, good] of cases) {
		assert.equal(fenceViolations("DsfConnector.ts", bad).length, 1, `not rejected: ${bad.trim()}`);
		assert.deepEqual(fenceViolations("DsfConnector.ts", good), [], `wrongly rejected: ${good.trim()}`);
	}
});

test("red check: commentary about a timer is prose, not a use of one", () => {
	assert.deepEqual(fenceViolations("DsfConnector.ts", "\t\t// the old code called setTimeout(fn, 10) here\n"), []);
	assert.deepEqual(fenceViolations("DsfConnector.ts", "\t * lastSeen used to be Date.now(), which is why this file slept\n"), []);
});

test("red check: clock.ts is the exemption, and it is exactly one file", () => {
	const raw = "\t\tconst t = setTimeout(fn, 10);\n";
	assert.deepEqual(fenceViolations("clock.ts", raw), [], "the seam may name the platform timer");
	assert.equal(fenceViolations("clock2.ts", raw).length, 1, "a second seam is not a seam");
});

test("red check: a module that owns a Clock but dropped its shadow is reported", () => {
	const owner = 'import { realClock, type Clock } from "./clock.ts";\n\nexport class X {}\n';
	const found = fenceViolations("NewConnector.ts", owner);
	assert.equal(found.length, SHADOWS.length, `expected one report per missing shadow, got ${JSON.stringify(found)}`);
	assert.match(found[0]!, /missing the shadow/);

	// With the prelude restored, it passes.
	const shadows = SHADOWS.map(n => `declare const ${n}: never;`).join("\n");
	assert.deepEqual(fenceViolations("NewConnector.ts", `${owner}\n${shadows}\n`), []);

	// A module that merely re-exports the TYPE owns no clock and needs nothing.
	assert.deepEqual(fenceViolations("index.ts", 'export type { Clock } from "./clock.ts";\n'), []);
});

test("every rule says why it exists", () => {
	for (const rule of RULES) assert.ok(rule.why.length > 20, `${rule.name} needs a reason`);
});
