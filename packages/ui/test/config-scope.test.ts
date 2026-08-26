/**
 * The machine/person split (spec §4). The rule that decides every row: if the
 * KEY SPACE belongs to the machine, the section belongs to the machine. A
 * colour keyed by heater index is a fact about which heater.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	splitOverlay, joinOverlay, MACHINE_SECTIONS, PERSON_SECTIONS, SPLIT_SECTIONS,
} from "../src/config/types.ts";
import { DEFAULT_CONFIG } from "../src/config/types.ts";

test("every section of the effective config is assigned to exactly one half", () => {
	const all = [...MACHINE_SECTIONS, ...PERSON_SECTIONS, ...SPLIT_SECTIONS] as string[];
	const keys = Object.keys(DEFAULT_CONFIG).sort();
	assert.deepEqual([...all].sort(), keys, "a new section must be given a scope, not defaulted into one");
	assert.equal(new Set(all).size, all.length, "no section may be in both halves");
});

test("the safety-critical sections are machine", () => {
	for (const k of ["shaping", "dockSensors", "axisRoles", "pins", "bed", "heaterColors", "sensorNames"]) {
		assert.ok((MACHINE_SECTIONS as string[]).includes(k), `${k} must be machine-scoped`);
	}
});

test("camera is split: the URL is the machine's, the pin is a habit", () => {
	assert.ok((MACHINE_SECTIONS as string[]).includes("camera"));
	assert.ok((PERSON_SECTIONS as string[]).includes("cameraPrefs"));
});

test("splitOverlay puts screens.layouts on the machine side and the rest on the person side", () => {
	const { machine, person } = splitOverlay({
		screens: { layouts: { machine: { c1: { row: 0 } } }, hidden: ["jobs"], renames: { machine: "Mach" } },
		shaping: { envelope: { x: [0, 300], y: [0, 300] } },
		thermalColors: { hot: "#f00" },
	} as never);
	assert.deepEqual(machine.screens, { layouts: { machine: { c1: { row: 0 } } } });
	assert.deepEqual(person.screens, { hidden: ["jobs"], renames: { machine: "Mach" } });
	assert.ok(machine.shaping, "shaping is machine");
	// Cast: PersonConfig has no `shaping` key at all, so this asserts the
	// stronger property that the RUNTIME object carries none either — not
	// merely that the static type hides it.
	assert.equal((person as Record<string, unknown>).shaping, undefined, "shaping must not appear in the person half");
	assert.ok(person.thermalColors, "thermalColors is person");
	assert.equal((machine as Record<string, unknown>).thermalColors, undefined);
});

test("split then join is the identity — nothing is lost across the boundary", () => {
	const overlay = {
		axisRoles: { U: "Z motor 1" },
		thermalColors: { hot: "#f00" },
		camera: { streamUrl: "http://cam/" },
		cameraPrefs: { pinned: true },
		screens: { layouts: { machine: { c1: { row: 2 } } }, hidden: ["macros"] },
		shaping: { defaults: { distMm: 100, speedMmS: 400, repeats: 3 } },
	} as never;
	const { machine, person } = splitOverlay(overlay);
	assert.deepEqual(joinOverlay(machine, person), overlay);
});

test("an empty screens half is omitted, not written as {}", () => {
	// An empty object in the overlay is not "no override" to a later merge —
	// keep the overlay meaning exactly what it meant.
	const { machine, person } = splitOverlay({ screens: { hidden: ["jobs"] } } as never);
	assert.equal(machine.screens, undefined);
	assert.deepEqual(person.screens, { hidden: ["jobs"] });
});
