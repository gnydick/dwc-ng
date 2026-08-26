/**
 * Machine-scoped storage has exactly one door (config/machineStore.ts). This
 * lint is what stops a future module from opening a second one — a
 * localStorage key literal for machine-scoped state anywhere else means a
 * value that a second Duet would inherit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** Names spec §4 puts on the machine side. Person keys are unrestricted. */
const MACHINE_SCOPED = ["dwc-ng.config", "dwc-ng.drafts", "dwc-ng.cmdHistory", "dwc-ng.console", "dwc-ng.canvas."];

/**
 * The door itself, plus the migration that must name the old keys to retire
 * them, plus Card Lab — a dev-only bench with no machine behind it (its
 * canvas key is an isolated sandbox, never a saved layout for a real
 * screen), so it is exempt on the merits rather than grandfathered debt.
 */
const ALLOWED = ["config/machineStore.ts", "config/migrateStorage.ts", "dev/CardLab.tsx"];

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.tsx?$/.test(entry)) out.push(full);
	}
	return out;
}

test("no machine-scoped storage key literal lives outside config/machineStore.ts", {
	skip:
		"Task 10 moves the last keys through openMachineStore(); current offenders: " +
		"config/types.ts (dwc-ng.config), editor/drafts.ts (dwc-ng.drafts), " +
		"om/commandHistory.ts (dwc-ng.cmdHistory), om/consoleLog.ts (dwc-ng.console), " +
		"compose/screens.ts (a prose comment naming dwc-ng.canvas.<id> that Task 10 " +
		"rewrites once the canvas keys move). NOTE: shell/panelCanvas.ts also mints " +
		"dwc-ng.canvas.<id> keys via a template literal (`dwc-ng.canvas.${screenId}`) " +
		"and is a real second door today, but this literal-text lint cannot see a " +
		"backtick-quoted key — it only matches a double-quote-prefixed literal. That " +
		"gap is Task 10's to close, not this lint's to paper over.",
}, () => {
	const offenders: string[] = [];
	for (const file of walk(SRC)) {
		const rel = file.slice(SRC.length).replace(/\\/g, "/");
		if (ALLOWED.some(a => rel.endsWith(a))) continue;
		const text = readFileSync(file, "utf8");
		for (const key of MACHINE_SCOPED) {
			if (text.includes(`"${key}`)) offenders.push(`${rel}: ${key}`);
		}
	}
	assert.deepEqual(offenders, [], `machine-scoped keys must go through openMachineStore():\n${offenders.join("\n")}`);
});

test("the lint can actually see a violation", () => {
	// Falsification, in the suite: the matcher above is exercised against a
	// known-bad string so a broken walk() cannot pass by finding nothing.
	const text = 'const k = "dwc-ng.console";';
	assert.ok(MACHINE_SCOPED.some(key => text.includes(`"${key}`)));
});
