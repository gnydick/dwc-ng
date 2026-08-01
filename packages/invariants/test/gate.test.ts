import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRegister } from "../src/cli.ts";
import { repoRoot } from "../src/scan.ts";
import { MIN_RUNG } from "../src/check.ts";

test("every declaration in the repo is valid", () => {
	const { problems } = buildRegister();
	assert.deepEqual(problems.map(p => `${p.file}:${p.line} ${p.message}`), []);
});

test("DRIFT: the committed register matches what the generator produces", () => {
	const { markdown } = buildRegister();
	const committed = readFileSync(join(repoRoot(), "docs", "invariant-register.md"), "utf8");
	assert.equal(
		committed,
		markdown,
		"docs/invariant-register.md is stale — run `pnpm --filter @dwc-ng/invariants generate`",
	);
});

test("DRIFT: the committed DEBT.md matches what the generator produces", () => {
	const { debtMarkdown } = buildRegister();
	const committed = readFileSync(join(repoRoot(), "DEBT.md"), "utf8");
	assert.equal(
		committed,
		debtMarkdown,
		"DEBT.md is stale — run `pnpm --filter @dwc-ng/invariants generate`",
	);
});

test("RATCHET: the debt count never exceeds the committed ceiling", () => {
	const { declarations, ceiling } = buildRegister();
	const debts = declarations.filter(d => d.rung < MIN_RUNG);
	assert.ok(
		debts.length <= ceiling,
		`${debts.length} invariants sit below rung ${MIN_RUNG} but the ceiling is ${ceiling}. ` +
			`Promote one, or raise the ceiling in packages/invariants/debt-ceiling.json as a deliberate act: ` +
			debts.map(d => d.id).join(", "),
	);
});
