/**
 * `generate` writes the register; `check` reports without writing. Both go
 * through buildRegister, and so do the gate tests — one assembly path, so a
 * green test cannot mean something different from a green CLI.
 */
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanTree, scanBroken, scanFiles, repoRoot } from "./scan.ts";
import { checkAll, type Declaration, type Problem } from "./check.ts";
import { renderRegister } from "./render.ts";
import { findRedFlags } from "./redFlags.ts";
import { strayLeads } from "./blocks.ts";
import { checkBroken, renderDebt, type RawBroken } from "./broken.ts";

const REGISTER = ["docs", "invariant-register.md"];
const DEBT = ["DEBT.md"];
const CEILING = ["packages", "invariants", "debt-ceiling.json"];
const DEBT_JSON = ["packages", "invariants", "debt.json"];

/**
 * The two ratchets, read the same way and validated the same way — a missing
 * or malformed ceiling is an error rather than a permissive default, because a
 * ceiling that silently reads as Infinity is worse than no gate at all.
 */
function readCeilings(root: string): { ceiling: number; redFlagCeiling: number } {
	const parsed: unknown = JSON.parse(readFileSync(join(root, ...CEILING), "utf8"));
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error('debt-ceiling.json must be { "ceiling": <int>, "redFlagCeiling": <int> }');
	}
	const record = parsed as Record<string, unknown>;
	const readOne = (name: string): number => {
		const value = record[name];
		if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
			throw new Error(`debt-ceiling.json: "${name}" must be a non-negative integer, got ${String(value)}`);
		}
		return value;
	};
	return { ceiling: readOne("ceiling"), redFlagCeiling: readOne("redFlagCeiling") };
}

/** The committed red-flag ceiling, for the gate test. */
export function redFlagCeiling(): number {
	return readCeilings(repoRoot()).redFlagCeiling;
}

/**
 * Entries from debt.json — defects with no code home. Read as UNTRUSTED: every
 * field arrives as `unknown` and is normalised to the same RawBroken shape the
 * source scanner produces, so both inputs meet exactly one set of rules in
 * checkBroken rather than each having its own.
 */
function readDebtJson(root: string): RawBroken[] {
	const file = DEBT_JSON.join("/");
	const parsed: unknown = JSON.parse(readFileSync(join(root, ...DEBT_JSON), "utf8"));
	if (typeof parsed !== "object" || parsed === null || !("entries" in parsed)) {
		throw new Error(`${file} must be { "entries": [...] }`);
	}
	const entries = (parsed as { entries: unknown }).entries;
	if (!Array.isArray(entries)) throw new Error(`${file}: "entries" must be an array`);
	const str = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
	return entries.map((entry: unknown, i) => {
		const e = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
		return {
			slug: str(e["slug"]) ?? `«entry ${i} has no slug»`,
			status: str(e["status"]),
			what: str(e["what"]),
			fix: str(e["fix"]),
			where: str(e["where"]),
			file,
			line: i + 1,
		};
	});
}

/**
 * Declaration-shaped lines the block reader cannot see, reported as problems so
 * `generate` refuses rather than quietly writing a register that omits them.
 * Both tags, one walk — a stray `@broken` is the same mistake.
 */
export function scanStrays(root: string): Problem[] {
	return scanFiles(root, (text, file) =>
		(["invariant", "broken"] as const).flatMap(tag =>
			strayLeads(text, tag).map(line => ({
				file,
				line,
				message: `"@${tag}" outside a block comment — only /* … */ is scanned, so this declares nothing`,
			})),
		),
	);
}

export function buildRegister(): {
	markdown: string;
	debtMarkdown: string;
	declarations: Declaration[];
	problems: Problem[];
	ceiling: number;
} {
	const root = repoRoot();
	const { ceiling } = readCeilings(root);
	const { declarations, problems } = checkAll(scanTree(root));
	const broken = checkBroken([...scanBroken(root), ...readDebtJson(root)]);
	return {
		markdown: renderRegister(declarations, ceiling),
		debtMarkdown: renderDebt(broken.entries),
		declarations,
		problems: [...problems, ...broken.problems, ...scanStrays(root)],
		ceiling,
	};
}

function main(): void {
	const command = process.argv[2] ?? "check";
	if (command === "flags") {
		const flags = findRedFlags(repoRoot());
		for (const f of flags) console.error(`${f.file}:${f.line}  ${f.message}`);
		console.log(`${flags.length} red-flag phrases without a declaration.`);
		return;
	}
	const { markdown, debtMarkdown, problems } = buildRegister();
	for (const p of problems) console.error(`${p.file}:${p.line}  ${p.message}`);
	if (command === "generate") {
		if (problems.length > 0) {
			console.error("Refusing to generate with unresolved problems.");
			process.exit(1);
		}
		writeFileSync(join(repoRoot(), ...REGISTER), markdown);
		writeFileSync(join(repoRoot(), ...DEBT), debtMarkdown);
		console.log(`Wrote ${REGISTER.join("/")} and ${DEBT.join("/")}`);
		return;
	}
	if (problems.length > 0) process.exit(1);
	console.log("Declarations valid.");
}

/**
 * Run main() ONLY when this file was invoked as the program — never when the
 * gate tests import buildRegister from it. `import.meta.url` alone cannot tell
 * the difference (it always ends with cli.ts), and getting this wrong would
 * have the test suite call process.exit mid-run.
 */
const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) main();
