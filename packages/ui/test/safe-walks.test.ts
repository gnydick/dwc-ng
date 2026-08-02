/**
 * A module that handles untrusted parsed data may not also use the unsafe walk.
 *
 * The rule is self-selecting rather than an allowlist: importing safeEntries IS
 * the declaration "this file walks data it did not author", and from that point
 * raw Object.entries is banned in it. Nothing has to be added by hand when a new
 * ingress point appears — the import that makes it safe is the same import that
 * arms the check.
 *
 * It costs nothing to comply. safeEntries is generic and drops only three keys
 * that cannot occur in a locally-built record, so converting a trusted walk is
 * a no-op — which is exactly why the ban can be total instead of negotiated.
 *
 * This exists because the audit that produced it found a real one:
 * sanitizeCanvas walked localStorage JSON with the raw form and assigned
 * out[id], so a stored "__proto__" key ran the prototype setter and the
 * returned object came back wearing an attacker-chosen prototype.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
/** The definition site, which necessarily names both. */
const KERNEL = "util/safeObject.ts";

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

test("a file that imports safeEntries never uses raw Object.entries", () => {
	const offenders: string[] = [];
	for (const file of sourceFiles()) {
		const rel = relative(SRC, file).replaceAll("\\", "/");
		if (rel === KERNEL) continue;
		const text = readFileSync(file, "utf8");
		if (!/\bsafeEntries\b/.test(text)) continue;
		text.split("\n").forEach((line, i) => {
			// Object.fromEntries is a different function and is not a walk.
			if (/(?<!from)\bObject\.entries\s*\(/.test(line) && !line.trimStart().startsWith("*")
				&& !line.trimStart().startsWith("//")) {
				offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
			}
		});
	}
	assert.deepEqual(offenders, [],
		`these files handle untrusted data and must use safeEntries throughout:\n${offenders.join("\n")}`);
});

test("sanitizeCanvas cannot be handed a prototype through stored JSON", async () => {
	const { sanitizeCanvas } = await import("../src/shell/panelCanvas.ts");
	// JSON.parse creates "__proto__" as an OWN property; a raw walk assigning
	// out[key] then runs the setter instead of adding an entry.
	const hostile: unknown = JSON.parse(
		'{"__proto__":{"col":1,"row":1,"colSpan":2,"rowSpan":2},"machine-status":{"col":0,"row":0,"colSpan":4,"rowSpan":4}}',
	);
	const out = sanitizeCanvas(hostile);
	assert.equal(Object.getPrototypeOf(out), Object.prototype);
	assert.deepEqual(Object.keys(out), ["machine-status"]);
});
