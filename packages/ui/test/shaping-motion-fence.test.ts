/**
 * The motion fence for the shaping feature (spec I7 / I1).
 *
 * The shaping screen is the one part of the UI that moves the carriage for its
 * own reasons rather than because an operator pressed a jog button, so "where
 * may machine access appear" is worth pinning structurally rather than by
 * review. Every rule below constrains a WHERE: the pattern is legal in exactly
 * the file that owns it and nowhere else under `src/shaping/`.
 *
 * That framing matters. A rule written as "this string must not appear"
 * silently passes while the feature is half-built and nobody has written the
 * string yet — it is a fence around an empty field. `fenceViolations()` is a
 * pure predicate over (path, source) so the tests below can feed it offending
 * source that does NOT exist on disk and prove it rejects it. `procedure.ts`
 * has not been written yet (task C2); the sendCode rule is proven to bite by
 * running it against source text, not by the absence of the file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SHAPING = new URL("../src/shaping", import.meta.url).pathname
	// Windows: strip the leading slash of /N:/… and normalize.
	.replace(/^\/([A-Za-z]:)/, "$1");

type Fence = {
	readonly name: string;
	readonly pattern: RegExp;
	/** Paths relative to src/shaping, "/"-separated. Empty = legal nowhere. */
	readonly allowedIn: readonly string[];
	readonly why: string;
};

const FENCES: readonly Fence[] = [
	{
		name: "sendCode(",
		pattern: /\bsendCode\s*\(/,
		allowedIn: ["procedure.ts"],
		why: "shaping talks to the machine only through Procedure.run() — a second caller is a second motion path with no Preconditions behind it",
	},
	{
		name: "G92",
		pattern: /G92/,
		allowedIn: [],
		why: "this feature never redefines the coordinate system; it reads position from the object model immediately before each move",
	},
	{
		name: "gc` tagged template",
		pattern: /(^|[^A-Za-z0-9_$])gc`/,
		allowedIn: [],
		why: "G-code is built by cmd.* builders in control/commands.ts, never assembled at the call site",
	},
	{
		name: "Capture._mint",
		pattern: /Capture\._mint/,
		allowedIn: ["engine/capture.ts"],
		why: "a Capture exists only because parseCapture accepted a file (I3)",
	},
	{
		name: "__verified",
		pattern: /__verified/,
		allowedIn: ["store.ts"],
		why: "the verified brand is minted only by verifyAnalysis() in store.ts (I6)",
	},
];

/**
 * The rule itself, as a predicate over one file's path and text. Exported
 * shape (not the module's, node:test has no exports) so both the on-disk walk
 * and the red checks below run the SAME code.
 */
function fenceViolations(rel: string, text: string): string[] {
	const out: string[] = [];
	const lines = text.split("\n");
	for (const fence of FENCES) {
		if (fence.allowedIn.includes(rel)) continue;
		lines.forEach((line, i) => {
			if (fence.pattern.test(line)) out.push(`${rel}:${i + 1}: ${fence.name} — ${line.trim()}`);
		});
	}
	return out;
}

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(full);
		else if (/\.(ts|tsx)$/.test(entry.name)) yield full;
	}
}

test("src/shaping obeys the motion fence", () => {
	const offenders: string[] = [];
	let scanned = 0;
	for (const file of walk(SHAPING)) {
		scanned++;
		const rel = relative(SHAPING, file).split(sep).join("/");
		offenders.push(...fenceViolations(rel, readFileSync(file, "utf8")));
	}
	// A walk that found nothing would pass every rule vacuously.
	assert.ok(scanned >= 12, `expected the shaping tree to be walked, scanned ${scanned} files`);
	assert.deepEqual(offenders, [], `motion fence:\n${offenders.join("\n")}`);
});

test("red check: sendCode( is rejected outside procedure.ts and accepted inside it", () => {
	const source = "\tconst reply = await conn.sendCode(cmd.waitMoves());\n";
	assert.deepEqual(fenceViolations("procedure.ts", source), [], "procedure.ts owns machine access");
	// Every other file in the tree, including ones that do not exist yet.
	for (const rel of ["store.ts", "results.ts", "apply.ts", "useEngine.ts", "engine/rank.ts"]) {
		const found = fenceViolations(rel, source);
		assert.equal(found.length, 1, `${rel} must be rejected, got ${JSON.stringify(found)}`);
		assert.match(found[0]!, /sendCode\(/);
	}
});

test("red check: G92 is rejected everywhere, including in procedure.ts", () => {
	const source = 'const zero = gcodeOf("G92 X0 Y0");\n';
	for (const rel of ["procedure.ts", "store.ts", "engine/capture.ts"]) {
		assert.equal(fenceViolations(rel, source).length, 1, `${rel} must reject G92`);
	}
});

test("red check: a gc tagged template is rejected everywhere", () => {
	const source = "const move = gc`G1 X${10} F6000`;\n";
	for (const rel of ["procedure.ts", "store.ts"]) {
		assert.equal(fenceViolations(rel, source).length, 1, `${rel} must reject a gc template`);
	}
	// The word "gcode" or a property named `.gc` is not the tag.
	assert.deepEqual(fenceViolations("store.ts", "const gcode = builder.gcode;\n"), []);
});

test("red check: Capture._mint is rejected outside engine/capture.ts", () => {
	const source = "\treturn Capture._mint(hz(rate), x, y, z);\n";
	assert.deepEqual(fenceViolations("engine/capture.ts", source), []);
	assert.equal(fenceViolations("engine/sweep.ts", source).length, 1);
	assert.equal(fenceViolations("procedure.ts", source).length, 1);
});

test("red check: the __verified brand is rejected outside store.ts", () => {
	const source = "declare const __verified: unique symbol;\n";
	assert.deepEqual(fenceViolations("store.ts", source), []);
	for (const rel of ["results.ts", "procedure.ts", "engine/rank.ts"]) {
		assert.equal(fenceViolations(rel, source).length, 1, `${rel} must reject the brand`);
	}
});

test("every fence names why it exists and where the match may live", () => {
	for (const fence of FENCES) {
		assert.ok(fence.why.length > 20, `${fence.name} needs a reason`);
		for (const rel of fence.allowedIn) assert.ok(!rel.startsWith("/") && !rel.includes("\\"), `${fence.name}: ${rel}`);
	}
});
