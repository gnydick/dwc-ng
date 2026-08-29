/**
 * The Shaping settings card (#31): the editor that makes `config.shaping`
 * reachable at all.
 *
 * Two things are being pinned here, and they are different in kind.
 *
 * The first is that the editor adds NO second gate. `asEnvelope` and
 * `isAccelAddr` (config/parse.ts) decide what a box and an address are, for
 * the SD file and for this card alike, and the card's job is only to report
 * their verdicts. So the property test below asks the card's per-axis probe
 * and the gate the same question over a table of drafts and requires the same
 * answer — if a rule ever gets restated in the editor, that is where the two
 * come apart.
 *
 * The second is that a refusal is SAID. The envelope gate is whole-or-nothing:
 * `lo >= hi` on one axis drops the entire box, so an editor that wrote and
 * moved on would look like it accepted a box that never reached the config.
 * These tests assert both halves of that at once — the store is `null` AND the
 * sentence the card renders names the axis and says the envelope is unset.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createConfigStore } from "../src/config/store.ts";
import { openMachineStore } from "../src/config/machineStore.ts";
import { parseOverlayPayload } from "../src/config/parse.ts";
import { CONFIG_VERSION } from "../src/config/types.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";
import { CARD_DEFS, cardTitleOf } from "../src/compose/defs.ts";
import { BUILTIN_SCREENS, SETTINGS_COMPOSITION } from "../src/compose/screens.ts";
import {
	BLANK_DRAFT, accelStatusText, draftEnvelope, draftOf, envelopeStatusText, isBlankDraft,
	judgeAccel, judgeDraft, rejectedAxes, sameDraft, type EnvelopeDraft,
} from "../src/shaping/settingsDraft.ts";

const src = (rel: string): string =>
	readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), "utf8");

const draft = (xLo: string, xHi: string, yLo: string, yHi: string): EnvelopeDraft =>
	({ xLo, xHi, yLo, yHi });

// ---------------------------------------------------------------- location

/**
 * The refusal copy sends the operator to a PLACE. Until this card existed the
 * place did not, which is the whole of #31 — so the phrase is assembled from
 * the screen registry and the card registry rather than written down twice.
 */
test('the card is reachable exactly where the refusal copy says: "Settings › Input shaping"', () => {
	assert.ok("settings-shaping" in CARD_DEFS, "the card is registered");
	assert.ok("settings-shaping" in SETTINGS_COMPOSITION, "and placed on the Settings screen");
	// compose/cards.tsx is JSX and cannot be imported under node's type
	// stripping, which is exactly why the registry is split in two — the
	// compiler already welds the halves (Record<CardId, CardRender>), so
	// reading the file is enough to see the body is wired.
	// Matched on the BODY rather than on the arrow's argument list: this used to
	// pin `body: () =>`, and broke the day the card started taking a ctx to
	// reach the shaping service — which changed nothing about the thing this
	// test is checking, namely that the id renders ShapingBody.
	assert.match(src("compose/cards.tsx"), /"settings-shaping":\s*\{ body: [^,]*<ShapingBody\b/);
	const location = `${BUILTIN_SCREENS.settings.name} › ${cardTitleOf("settings-shaping")}`;
	assert.equal(location, "Settings › Input shaping");
});

/**
 * And the copy stays consistent as the card is renamed or moved. Every
 * "Settings › X" written anywhere in src must name a card TITLED X that is
 * actually placed on the Settings screen — so retitling this card without
 * retitling the refusal is a failing test rather than a wrong sentence on a
 * disabled button.
 *
 * The refusal table itself lands with the Shaping Lab cards (work item D); on
 * a tree without it this scan finds nothing to check and the assertion above
 * is what carries the phrase. Written as a scan anyway, because the moment the
 * two meet it is the check that keeps them together.
 */
test("every 'Settings › X' in the source names a card that is on the Settings screen", () => {
	const onSettings = new Set(
		Object.keys(SETTINGS_COMPOSITION)
			.filter((id): id is keyof typeof CARD_DEFS => id in CARD_DEFS)
			.map(id => cardTitleOf(id)),
	);
	const files = ["shaping/copy.ts", "cards/SettingsCards.tsx", "compose/defs.ts"];
	for (const rel of files) {
		let text: string;
		try {
			text = src(rel);
		} catch {
			continue; // not on this tree
		}
		for (const [, title] of text.matchAll(/Settings › ([A-Z][A-Za-z ]*[A-Za-z])/g)) {
			assert.ok(onSettings.has(title!), `${rel} points at "Settings › ${title!}", which is not a card there`);
		}
	}
});

// ------------------------------------------------------- one gate, not two

/**
 * The tripwire test. `rejectedAxes` must be empty exactly when the gate mints
 * a box — if the editor ever grows a rule of its own, this is what catches the
 * first draft the two disagree about.
 */
test("the card's per-axis probe and the gate never disagree", () => {
	const values = ["", " ", "0", "10", "-50", "300", "300.5", "abc", "NaN", "Infinity", "1e3"];
	let refusals = 0;
	let acceptances = 0;
	for (const xLo of values) for (const xHi of values) {
		// Y is swept over a smaller set so the table stays a table; every
		// combination of an X pair with a Y pair is still covered.
		for (const y of [["0", "300"], ["300", "0"], ["", ""], ["5", "5"]] as const) {
			const d = draft(xLo, xHi, y[0], y[1]);
			const axes = rejectedAxes(d);
			const gated = draftEnvelope(d);
			assert.equal(axes.length === 0, gated !== null,
				`probe and gate disagree on ${JSON.stringify(d)}`);
			if (gated === null) refusals++; else acceptances++;
		}
	}
	// A property test that only ever saw one side would pass vacuously.
	assert.ok(refusals > 0 && acceptances > 0, `saw ${refusals} refusals and ${acceptances} acceptances`);
});

test("a blank field is NaN, not zero — a missing edge is not the origin", () => {
	assert.equal(draftEnvelope(draft("", "300", "0", "300")), null);
	assert.deepEqual(rejectedAxes(draft("", "300", "0", "300")), ["X"]);
	assert.ok(isBlankDraft(BLANK_DRAFT));
	assert.ok(!isBlankDraft(draft("0", "", "", "")));
});

// -------------------------------------------------------------- round trip

test("envelope round-trip: set it, reload it from the overlay, same box", () => {
	// shaping is machine-scoped (Ruling 17, campaign #76 phase 1 task 8): an
	// identified machine is what makes its snapshot half attributable, and so
	// restorable on revert. See test/config-cache-scope.test.ts for the
	// cross-machine case this split exists to close.
	withLocalStorage(() => {
		const machine = openMachineStore({ kind: "board", uniqueId: "envelope-roundtrip" });
		const store = createConfigStore({ machineStore: () => machine });
		const typed = draft("0", "300", "10", "290");
		store.setShaping({ envelope: draftEnvelope(typed) });
		assert.deepEqual(store.config.shaping.envelope, { x: [0, 300], y: [10, 290] });

		// Out to the file the machine keeps, and back in through the parse
		// boundary — the same shape rr_upload writes and rr_download returns
		// (config.shaping IS the shaping section of that overlay; saveToMachine
		// puts it there unchanged — see config/store.ts).
		const payload = JSON.stringify({ version: CONFIG_VERSION, overlay: { shaping: store.config.shaping } });
		assert.deepEqual(parseOverlayPayload(payload)?.shaping?.envelope, { x: [0, 300], y: [10, 290] });

		// And restoring it puts the SAME box back, not an approximation of one.
		store.snapshot("round trip");
		store.setShaping({ envelope: null });
		assert.equal(store.config.shaping.envelope, null);
		store.revert(store.snapshots[0]!.id);
		assert.deepEqual(store.config.shaping.envelope, { x: [0, 300], y: [10, 290] });
		// The fields the card would show are the fields that were typed.
		assert.ok(sameDraft(draftOf(store.config.shaping.envelope), typed));
	});
});

test("negative bounds round-trip — an axis is allowed to run below zero", () => {
	const store = createConfigStore({ machineStore: () => null });
	const typed = draft("-50", "50", "-10", "0");
	store.setShaping({ envelope: draftEnvelope(typed) });
	assert.deepEqual(store.config.shaping.envelope, { x: [-50, 50], y: [-10, 0] });
	assert.ok(sameDraft(draftOf(store.config.shaping.envelope), typed));
});

// --------------------------------------------------- the refusal is spoken

/**
 * Whole-or-nothing, from both sides at once: the store holds `null` AND the
 * card says which axis did it and that the box is gone. Asserting only the
 * first would pass for an editor that silently discarded the operator's box,
 * which is the exact defect #31 is about.
 */
test("a refused range leaves the envelope null AND is reported by name", () => {
	const cases: ReadonlyArray<readonly [EnvelopeDraft, string]> = [
		[draft("300", "0", "10", "290"), "X refused"],
		[draft("0", "300", "290", "10"), "Y refused"],
		[draft("10", "10", "0", "300"), "X refused"],
		[draft("0", "300", "5", "5"), "Y refused"],
		[draft("abc", "300", "0", "300"), "X refused"],
		[draft("0", "300", "", "290"), "Y refused"],
		[draft("300", "0", "290", "10"), "X and Y refused"],
	];
	for (const [typed, lead] of cases) {
		const store = createConfigStore({ machineStore: () => null });
		// Start from a GOOD box, so the test can see the refusal take it away.
		store.setShaping({ envelope: draftEnvelope(draft("0", "200", "0", "200")) });
		assert.notEqual(store.config.shaping.envelope, null);

		store.setShaping({ envelope: draftEnvelope(typed) });
		assert.equal(store.config.shaping.envelope, null,
			`stored box must drop whole: ${JSON.stringify(typed)}`);

		const said = envelopeStatusText(judgeDraft(typed, store.config.shaping.envelope));
		assert.ok(said.startsWith(lead), `expected "${lead}…", got "${said}"`);
		assert.match(said, /Envelope unset/,
			"the sentence must say the WHOLE box is gone, not just that an axis was wrong");
	}
});

test("an accepted box is reported as set, with its travel", () => {
	const store = createConfigStore({ machineStore: () => null });
	store.setShaping({ envelope: draftEnvelope(draft("0", "300", "10", "290")) });
	assert.equal(
		envelopeStatusText(judgeDraft(null, store.config.shaping.envelope)),
		"Set — 300 × 280 mm of travel.",
	);
});

test("the shipped state says so rather than saying nothing (I8)", () => {
	const store = createConfigStore({ machineStore: () => null });
	assert.equal(store.config.shaping.envelope, null);
	assert.equal(
		envelopeStatusText(judgeDraft(null, store.config.shaping.envelope)),
		"Not set — shaping cannot move until you draw this box.",
	);
	// Typed but not yet committed is a THIRD state; reporting it as a refusal
	// would accuse the operator mid-keystroke.
	assert.equal(
		envelopeStatusText({ kind: "pending" }),
		"Not applied — press Enter or leave the field.",
	);
});

test("reset returns the section to the shipped defaults, envelope back to null", () => {
	const store = createConfigStore({ machineStore: () => null });
	store.setShaping({ envelope: draftEnvelope(draft("0", "300", "0", "300")), defaults: { distMm: 80 } });
	store.setAccelAddr(0, "20.0");
	store.resetSection("shaping");
	assert.equal(store.config.shaping.envelope, null);
	assert.deepEqual(store.config.shaping.defaults, { distMm: 60, speedMmS: 200, repeats: 3 });
	assert.deepEqual(store.config.shaping.accelByTool, {});
	// And the card falls straight back to the unset sentence, because it reads
	// the store rather than remembering what it wrote.
	assert.ok(isBlankDraft(draftOf(store.config.shaping.envelope)));
});

// ------------------------------------------------------ accelerometer rows

test("a malformed accelerometer address is refused by the store AND reported", () => {
	for (const bad of ["nonsense", "20", ".0", "20.", "20.0.0", " 20.0", "a.b", "-1.0"]) {
		const store = createConfigStore({ machineStore: () => null });
		store.setAccelAddr(0, bad);
		assert.equal(store.config.shaping.accelByTool[0], undefined,
			`a bad address must never land: ${bad}`);
		const status = judgeAccel(bad, bad, store.config.shaping.accelByTool[0], false);
		assert.deepEqual(status, { kind: "refused" });
		assert.equal(accelStatusText(status), "needs board.device");
	}
});

test("a refused address does not quietly replace a working one", () => {
	const store = createConfigStore({ machineStore: () => null });
	store.setAccelAddr(1, "21.0");
	store.setAccelAddr(1, "twenty-one");
	assert.equal(store.config.shaping.accelByTool[1], "21.0", "the mapping survives");
	// …and the row still says the commit was refused, rather than showing the
	// old address as though the operator had typed it.
	assert.deepEqual(
		judgeAccel("twenty-one", "twenty-one", store.config.shaping.accelByTool[1], true),
		{ kind: "refused" },
	);
});

test("a tool with no mapping, and a mapping with no sensor, both say so", () => {
	const store = createConfigStore({ machineStore: () => null });
	assert.equal(accelStatusText(judgeAccel("", null, store.config.shaping.accelByTool[3], false)), "not mapped");

	store.setAccelAddr(3, "23.0");
	const stored = store.config.shaping.accelByTool[3];
	assert.equal(accelStatusText(judgeAccel("23.0", null, stored, true)), "",
		"a working mapping says nothing — the address is already in the field");
	assert.equal(accelStatusText(judgeAccel("23.0", null, stored, false)), "no sensor at 23.0");
});

test("typing is not refusing: an uncommitted edit reads as pending", () => {
	const store = createConfigStore({ machineStore: () => null });
	store.setAccelAddr(2, "22.0");
	const stored = store.config.shaping.accelByTool[2];
	// Mid-keystroke after a commit that succeeded.
	assert.deepEqual(judgeAccel("22.", "22.0", stored, true), { kind: "pending" });
	// And typing over a WORKING address with nothing committed since. This is
	// the one the browser caught: anchored on the last commit alone, the row
	// went on reporting the old mapping's verdict beside the new text.
	assert.deepEqual(judgeAccel("21", null, stored, true), { kind: "pending" });
	assert.equal(accelStatusText({ kind: "pending" }), "not applied");
});

// ----------------------------------------------- the reserved slots persist

/**
 * POSITIONAL STABILITY, as a check that can fail.
 *
 * Every message on this card lives in a slot that is present whether or not
 * there is anything to say — a fixed-height paragraph for the envelope and
 * the motion note, a fixed-width span per tool row. Delete the reservation and
 * the card gains and loses rows as the operator mistypes, which is the one
 * thing the house style will not have. A browser measurement is what PROVED
 * it (0 of 66 descendants moved across every state this card has); this is
 * what stops it being undone by an edit to the stylesheet.
 */
test("the status slots are reserved, not conditional", () => {
	const css = src("app.css").replace(/\/\*[\s\S]*?\*\//g, "");
	const rule = (sel: string): string => {
		const found = [...css.matchAll(new RegExp(`(^|[,}])\\s*${sel.replace(/[.[\]"=]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g"))];
		assert.ok(found.length > 0, `no rule for ${sel}`);
		return found[found.length - 1]![2]!;
	};
	// A fixed height, so an appearing sentence pushes nothing down.
	// Anchored so `line-height` and `min-height` cannot stand in for the one
	// declaration that actually reserves the space.
	assert.match(rule(".env-status"), /(^|[;{\s])height:\s*calc\(/);
	// `.accel-status` was checked here too, until #140 moved the accelerometer
	// rows onto their own card. The same assertion now lives beside them, in
	// test/accelerometer-card.test.ts.
	// And the refusal mark on a bound costs no layout: inset shadow, no border.
	assert.match(rule('.field input.env-bound[aria-invalid="true"]'), /box-shadow:\s*inset/);
});

/**
 * The rendered card must be the same verdict these tests check. A body that
 * computed its own sentence would pass everything above and still lie on
 * screen, so the render is welded to the two copy functions here.
 */
test("the card renders the verdict functions rather than sentences of its own", () => {
	const body = src("cards/SettingsCards.tsx");
	assert.match(body, /\{envelopeStatusText\(verdict\(\)\)\}/);
	// The accelerometer half of this assertion moved with the rows in #140.
	// test/accelerometer-card.test.ts checks `accelStatusText(judgeAccel(`
	// against AccelerometersBody's OWN text, which is the stronger form: this
	// file-wide scan would have gone on passing had the rows never moved.
	// And it never re-tests an address or a bound itself.
	assert.doesNotMatch(body, /isAccelAddr/);
	assert.doesNotMatch(body, /\bShapingBody[\s\S]*?\basRange\b/);
});
