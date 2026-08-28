/**
 * Migration against a machine an OLDER build left behind (GIT_114).
 *
 * This is the test the mock's state file exists for. Every other migration
 * test in this package builds its "old" payload in the same file that asserts
 * on it — the fixture and the parser share an author, so they agree by
 * construction and a v2 file the real thing never produces is indistinguishable
 * from one it does. On 2026-08-26 a v2 config on the real SD failed to load,
 * twice, and reached the printer with the suite green.
 *
 * `packages/mock-duet/test/fixtures/state-v2-toolchanger.json` is different in
 * kind: nobody typed it. A mock-duet was started with the pre-v3 config seed,
 * driven over HTTP (rr_gcode G28, rr_gcode T2, rr_upload of a macro) and then
 * killed with `Stop-Process -Force`; the file is what the board had on its card
 * at that instant. Loading it here puts a CURRENT build in front of a machine
 * an older one left behind, over the real endpoints, and asks what migration
 * does to it.
 *
 * The fixture is copied to a scratch path first: a mock pointed at the repo
 * copy would rewrite it the moment the migration wrote the card back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "solid-js";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMockServer } from "../../mock-duet/src/server.ts";
import { loadCaptureFile } from "../../mock-duet/src/capture.ts";
import { PollConnector } from "@dwc-ng/connector/testing";
import { createConfigStore } from "../src/config/store.ts";
import { openMachineStore } from "../src/config/machineStore.ts";
import { CONFIG_FILE, CONFIG_VERSION } from "../src/config/types.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";

const FIXTURE = new URL("../../mock-duet/test/fixtures/state-v2-toolchanger.json", import.meta.url);
const CAPTURE = new URL("../../mock-duet/captures/om-snapshot-2026-07-12.json", import.meta.url);

/** The mainboard the fixture's machine actually is (capture `boards[0]`). */
const BOARD = { kind: "board", uniqueId: "0JDAM-9F6NU-F05S0-7JKDJ-3SD6T-1SWQ1" } as const;

test("a v2 machine an older build left on its card migrates to v3 in place", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ui-migrate-state-"));
	const statePath = join(dir, "machine.state.json");
	const fixtureBytes = readFileSync(FIXTURE);
	writeFileSync(statePath, fixtureBytes);

	const model = loadCaptureFile(fileURLToPath(CAPTURE));
	const mock = createMockServer({ tickMs: 0, model, statePath });
	assert.deepEqual(mock.stateRestore, { kind: "restored" }, "the fixture is the machine under test");
	const port = await mock.listen(0);
	const connector = new PollConnector({ baseUrl: `http://127.0.0.1:${port}`, autoPoll: false, retryDelayMs: 10 });

	try {
		await connector.connect();

		// BEFORE: the card carries a pre-v3 file, with no machine stamp. This
		// is not asserted for decoration — if the fixture ever stops being a v2
		// machine, everything below tests nothing.
		const before = JSON.parse(await connector.download(CONFIG_FILE));
		assert.equal(before.version, 2, "the fixture's card holds a v2 config");
		assert.equal(before.machineId, undefined, "a v2 file was never stamped");
		assert.equal(before.overlay.shaping.accelByTool["0"], "20.0");

		await new Promise<void>((resolve, reject) => {
			createRoot(dispose => {
				withLocalStorage(() => {
					const store = createConfigStore({ machineStore: () => openMachineStore(BOARD) });
					store.loadFromMachine(connector).then(() => {
						try {
							// The v2 machine half was ADOPTED, not dropped: this
							// board's own card is its proof of origin.
							assert.equal(store.config.axisRoles["U"], "Z motor 1");
							assert.equal(store.config.axisRoles["C"], "Coupler");
							assert.deepEqual(store.config.dockSensors["3"], { gpIn: 13 });
							assert.equal(store.config.shaping.accelByTool["2"], "22.0");
							assert.equal(store.dirty, false, "a migration lands clean, not as an unsaved edit");
							resolve();
						} catch (err) {
							reject(err);
						} finally {
							dispose();
						}
					}, reject);
				});
			});
		});

		// AFTER: the migration wrote the card back, stamped for THIS board, so
		// the next boot has nothing left to migrate. That write went through
		// the mock's real rr_upload — and therefore through the state file.
		const after = JSON.parse(await connector.download(CONFIG_FILE));
		assert.equal(after.version, CONFIG_VERSION, "the card was rewritten at the current version");
		assert.equal(after.machineId, `b.${BOARD.uniqueId}`, "and stamped for the board it was read from");
		assert.equal(after.overlay.shaping.accelByTool["0"], "20.0", "the v2 content survived the rewrite");
	} finally {
		await connector.disconnect().catch(() => undefined);
		await mock.close();
	}

	// The migrated card OUTLIVES the mock: a restart reads back v3, not the v2
	// the fixture started as. Without persistence this whole test could only
	// ever have run against a machine the test itself built.
	// Constructed, not listened on: restoring the state file happens at
	// construction, and this assertion is about what came off disk.
	const restarted = createMockServer({ tickMs: 0, model: loadCaptureFile(fileURLToPath(CAPTURE)), statePath });
	try {
		assert.deepEqual(restarted.stateRestore, { kind: "restored" });
		const persisted = JSON.parse(new TextDecoder().decode(restarted.machine.sd.read(CONFIG_FILE)!));
		assert.equal(persisted.version, CONFIG_VERSION);
		assert.equal(persisted.machineId, `b.${BOARD.uniqueId}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}

	// And the committed fixture is untouched: still the v2 machine for the next
	// run. A test that migrates the artefact it is supposed to migrate FROM
	// passes once and then tests nothing.
	assert.deepEqual(readFileSync(FIXTURE), fixtureBytes, "the repo's fixture was written to");
});
