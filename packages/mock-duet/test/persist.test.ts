/**
 * The state file (GIT_114).
 *
 * Four properties, one per requirement in the ticket:
 *   - a round trip carries BOTH halves of the snapshot (SD tree + the machine
 *     state a session established);
 *   - a file damaged at any point always either loads whole or is refused with
 *     a reason — never a silent partial restore, which is what an abrupt
 *     `Stop-Process -Force` would otherwise leave behind;
 *   - a committed fixture loads deterministically;
 *   - with no state path, nothing is written to disk anywhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { startMock } from "./helpers.ts";
import { decodeSnapshot } from "../src/persist.ts";
import { loadCaptureFile } from "../src/capture.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
/** The committed state fixture: a real pre-v3 machine, written by a mock. */
const FIXTURE = new URL("./fixtures/state-v2-toolchanger.json", import.meta.url);

/** The board the fixture was taken from — the bundled toolchanger capture. */
function toolchanger(): ReturnType<typeof loadCaptureFile> {
	return loadCaptureFile(fileURLToPath(new URL("../captures/om-snapshot-2026-07-12.json", import.meta.url)));
}

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "mock-state-"));
}

/** Everything under `dir`, relative and slash-separated. */
function walk(dir: string, base = dir): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full, base));
		else out.push(relative(base, full).replaceAll("\\", "/"));
	}
	return out.sort();
}

test("a restart restores the SD tree AND the machine state, from one file", async () => {
	const dir = scratch();
	const statePath = join(dir, "machine.state.json");
	try {
		const first = await startMock({ statePath });
		const key = await first.connect();
		try {
			// Every category requirement 2 lists, established the way a person
			// establishes it: through the API, not by poking the objects.
			const body = 'M104 S215\n; written through rr_upload\n';
			const upload = await fetch(`${first.base}/rr_upload?name=0:/macros/warmup.g&time=2026-08-27T10:00:00`, {
				method: "POST",
				headers: { "X-Session-Key": String(key) },
				body,
			});
			assert.deepEqual(await upload.json(), { err: 0 });
			assert.deepEqual(await first.getJson("rr_mkdir?dir=0:/gcodes/archive", key), { err: 0 });
			assert.deepEqual(await first.getJson("rr_delete?name=0:/macros/cooldown.g", key), { err: 0 });
			// A whole config file, the artefact this ticket exists for.
			const config = JSON.stringify({ version: 3, machineId: "b.STATE-TEST", overlay: { axisRoles: { U: "leadscrew" } } });
			await fetch(`${first.base}/rr_upload?name=0:/sys/dwc-ng-config.json`, {
				method: "POST",
				headers: { "X-Session-Key": String(key) },
				body: config,
			});
			// Machine state: homed axes and the selected tool.
			await first.getJson("rr_gcode?gcode=G28%20X%20Y", key);
			await first.getJson("rr_gcode?gcode=T0", key);

			assert.equal(existsSync(statePath), true, "the state file exists once something changed");
		} finally {
			await first.close();
		}

		const second = await startMock({ statePath });
		try {
			assert.deepEqual(second.stateRestore, { kind: "restored" });

			assert.equal(
				new TextDecoder().decode(second.machine.sd.read("0:/macros/warmup.g")!),
				'M104 S215\n; written through rr_upload\n',
				"an uploaded macro came back byte for byte",
			);
			assert.equal(
				new TextDecoder().decode(second.machine.sd.read("0:/sys/dwc-ng-config.json")!),
				JSON.stringify({ version: 3, machineId: "b.STATE-TEST", overlay: { axisRoles: { U: "leadscrew" } } }),
				"the config file survived",
			);
			assert.notEqual(second.machine.sd.node("0:/gcodes/archive"), null, "a created directory survived");
			assert.equal(second.machine.sd.read("0:/macros/cooldown.g"), null, "a DELETION survived too");
			// The indexes, not just the tree: a restored job file with no
			// fileinfo behind it cannot be started.
			assert.equal(second.machine.sd.fileInfo.has("0:/gcodes/benchy.gcode"), true);
			assert.equal(second.machine.sd.thumbnails.has("0:/gcodes/seat support - PLA.gcode"), true);

			const axes = second.machine.om.move.axes as { letter: string; homed: boolean }[];
			assert.deepEqual(
				axes.filter(a => a.homed).map(a => a.letter),
				["X", "Y"],
				"exactly the axes that were homed, and no others",
			);
			assert.equal(second.machine.om.state.currentTool, 0, "the selected tool came back");
			assert.equal(second.machine.om.tools[0].state, "active", "and it came back SELECTED, not merely numbered");
		} finally {
			await second.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a file truncated anywhere never restores in part — it is refused, with a reason", async () => {
	const dir = scratch();
	const statePath = join(dir, "machine.state.json");
	try {
		const first = await startMock({ statePath });
		const key = await first.connect();
		await fetch(`${first.base}/rr_upload?name=0:/macros/kill-test.g`, {
			method: "POST",
			headers: { "X-Session-Key": String(key) },
			body: "G28\n",
		});
		await first.getJson("rr_gcode?gcode=G28", key);
		await first.close();

		const whole = readFileSync(statePath, "utf8");
		assert.equal(decodeSnapshot(whole).ok, true, "the complete file is the control");

		// A `Stop-Process -Force` can land between any two bytes. Sample the
		// prefixes densely enough to include the header boundary and the tail.
		const cuts = new Set<number>([0, 1, 20, whole.indexOf("\n"), whole.indexOf("\n") + 1, whole.length - 1]);
		for (let i = 0; i < whole.length; i += Math.max(1, Math.floor(whole.length / 60))) cuts.add(i);

		for (const cut of [...cuts].filter(c => c >= 0 && c < whole.length)) {
			const partial = whole.slice(0, cut);
			const decoded = decodeSnapshot(partial);
			assert.equal(decoded.ok, false, `a ${cut}-byte prefix decoded as a snapshot`);

			writeFileSync(statePath, partial);
			const mock = await startMock({ statePath });
			try {
				assert.equal(mock.stateRestore!.kind, "unreadable", `a ${cut}-byte prefix was not reported unreadable`);
				// Started CLEAN: the seed is intact and nothing from the damaged
				// file leaked in.
				assert.notEqual(mock.machine.sd.read("0:/macros/cooldown.g"), null, "the seed is back");
				assert.equal(mock.machine.sd.read("0:/macros/kill-test.g"), null, "no half-restore");
				const axes = mock.machine.om.move.axes as { homed: boolean }[];
				assert.equal(axes.some(a => a.homed), false, "and no machine state either");
			} finally {
				await mock.close();
			}
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the destination is replaced whole: a kill leaves the PREVIOUS file, never a prefix", async () => {
	// The guarantee is write-temp-then-rename. What is observable from here is
	// its consequence: at no instant does the destination path hold anything
	// but a complete, crc-valid file — so the bytes still being written are in
	// a temp file, under a name the loader never looks at.
	const dir = scratch();
	const statePath = join(dir, "machine.state.json");
	try {
		const mock = await startMock({ statePath });
		try {
			const key = await mock.connect();
			const seen: string[] = [];
			for (let i = 0; i < 12; i++) {
				await fetch(`${mock.base}/rr_upload?name=0:/gcodes/churn-${i}.gcode`, {
					method: "POST",
					headers: { "X-Session-Key": String(key) },
					body: "G1 X1\n".repeat(400 * (i + 1)),
				});
				const text = readFileSync(statePath, "utf8");
				// The header line carries the payload's length and crc, so two
				// different machines can never share one.
				seen.push(text.slice(0, text.indexOf("\n")));
				assert.equal(decodeSnapshot(text).ok, true, `the file on disk after write ${i} was not whole`);
			}
			assert.equal(new Set(seen).size, 12, "the file really was rewritten each time, so the check above was not vacuous");

			// The temp file lives beside the destination and is never mistaken for it.
			const stray = walk(dir).filter(f => f !== "machine.state.json");
			assert.deepEqual(stray, [], `left behind: ${stray.join(", ")}`);
		} finally {
			await mock.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a committed state fixture loads deterministically", async () => {
	// Requirement 4: "here is a real v2 machine" is a checked-in artefact. The
	// fixture is COPIED first — a mock pointed at the repo copy would rewrite it
	// the moment anything changed. It was produced by driving a mock over HTTP
	// (rr_gcode G28, rr_gcode T2, rr_upload) and then killing that mock with
	// `Stop-Process -Force`, which is the whole point: these are bytes a running
	// board wrote, not bytes a test author typed.
	const dir = scratch();
	const statePath = join(dir, "copy.state.json");
	try {
		writeFileSync(statePath, readFileSync(FIXTURE));
		for (const round of [1, 2]) {
			const mock = await startMock({ statePath, model: toolchanger() });
			try {
				assert.deepEqual(mock.stateRestore, { kind: "restored" }, `round ${round}`);
				const config = JSON.parse(new TextDecoder().decode(mock.machine.sd.read("0:/sys/dwc-ng-config.json")!));
				assert.equal(config.version, 2, "the fixture really is a pre-v3 machine");
				assert.equal(mock.machine.om.state.currentTool, 2);
				const axes = mock.machine.om.move.axes as { letter: string; homed: boolean }[];
				assert.deepEqual(axes.filter(a => a.homed).map(a => a.letter), ["X", "Y", "Z"]);
				assert.notEqual(mock.machine.sd.read("0:/macros/park-toolhead.g"), null);
			} finally {
				await mock.close();
			}
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a state file from ANOTHER machine is refused whole, not applied in part", async () => {
	// The toolchanger fixture selects tool 2 and homes X/Y/Z. The synthetic
	// default board has one tool. Restoring the SD card and quietly dropping the
	// tool selection is exactly the half-restore this module exists to prevent,
	// so the mismatch is refused before anything is touched.
	const dir = scratch();
	const statePath = join(dir, "copy.state.json");
	try {
		writeFileSync(statePath, readFileSync(FIXTURE));
		const mock = await startMock({ statePath });
		try {
			assert.equal(mock.stateRestore!.kind, "unreadable");
			assert.match((mock.stateRestore as { reason: string }).reason, /tool 2/);
			assert.equal(mock.machine.sd.read("0:/macros/park-toolhead.g"), null, "the SD card was not touched either");
		} finally {
			await mock.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("no flag, no persistence: nothing is written to disk anywhere", async () => {
	const dir = scratch();
	const before = statSync(dir).mtimeMs;
	try {
		const mock = await startMock();
		try {
			assert.equal(mock.state, null, "no state store was built at all");
			assert.equal(mock.stateRestore, null);
			const key = await mock.connect();
			// The same mutation battery the round-trip test uses.
			await fetch(`${mock.base}/rr_upload?name=0:/macros/nothing.g`, {
				method: "POST",
				headers: { "X-Session-Key": String(key) },
				body: "G28\n",
			});
			await mock.getJson("rr_mkdir?dir=0:/gcodes/nothing", key);
			await mock.getJson("rr_delete?name=0:/macros/cooldown.g", key);
			await mock.getJson("rr_gcode?gcode=G28", key);
			await mock.getJson("rr_gcode?gcode=T1", key);
		} finally {
			await mock.close();
		}

		assert.deepEqual(walk(dir), [], "the default path wrote a file");
		assert.equal(statSync(dir).mtimeMs, before, "the default path touched the directory");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("persist.ts is the only writer in the package", () => {
	// The behavioural test above can only prove that nothing was written where
	// it happened to look. This one covers everywhere else: if no other module
	// can even name a write, then "no store, no write" is a property of the
	// package rather than of one temp directory.
	const WRITERS = /\b(writeFileSync|writeFile|appendFile|appendFileSync|createWriteStream|openSync|open|mkdirSync|mkdir|renameSync|rename|rmSync|unlinkSync|writeSync|cpSync|copyFileSync)\b/;
	const offenders: string[] = [];
	const walkSrc = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walkSrc(full);
				continue;
			}
			if (!entry.name.endsWith(".ts")) continue;
			if (full.endsWith(join("src", "persist.ts"))) continue;
			readFileSync(full, "utf8").split("\n").forEach((line, i) => {
				if (/node:fs/.test(line) && WRITERS.test(line)) {
					offenders.push(`${relative(SRC, full).replaceAll("\\", "/")}:${i + 1}  ${line.trim()}`);
				}
			});
		}
	};
	walkSrc(SRC);
	assert.deepEqual(offenders, [], `a second filesystem writer:\n${offenders.join("\n")}`);
});
