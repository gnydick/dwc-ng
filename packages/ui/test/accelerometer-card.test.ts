/**
 * The Accelerometers card (#140): the accelerometer address and its sampling
 * rate, out of "Settings › Input shaping" and onto a card of their own.
 *
 * WHY THIS IS ITS OWN CARD. An accelerometer address and a sample rate are
 * properties of the MACHINE, not of the input-shaping feature. They lived on a
 * shaping-branded card only because the Shaping Lab was the first thing to want
 * them; #47's machine-dynamics battery wants the same two facts and has no
 * business reaching them through a shaping editor. Gabe, 2026-08-28: "split
 * accelerometers & sampling configs out of the input shaping card into 1 shared
 * card".
 *
 * WHAT IS PINNED HERE, and it is three separable things.
 *
 * The first is that the split ACTUALLY HAPPENED: the two sections are on the
 * new body and gone from the old one. Asserted per BODY rather than per file,
 * because both bodies live in cards/SettingsCards.tsx and a file-wide scan
 * would go on passing if the rows had never moved at all.
 *
 * The second is that the move created no second reader. The rows keep going
 * through `judgeAccel`/`accelStatusText` and through the ONE `accel` service
 * entry (compose/accelService.ts, GIT_126) that the Lab's Capture card also
 * takes — so a rate shown in Settings and a rate a run uses cannot be two
 * different answers. A body that re-derived an address or wrote its own
 * sentence would pass a "the card exists" test and still be wrong.
 *
 * The third is that an operator who saved the Settings screen BEFORE this
 * change gets the card. #86's mergeComposition is what makes that true and it
 * is new machinery, so the path is exercised here for this id rather than
 * assumed from the general test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CARD_DEFS, cardTitleOf } from "../src/compose/defs.ts";
import { BUILTIN_SCREENS, SETTINGS_COMPOSITION } from "../src/compose/screens.ts";
import { mergeComposition, parseComposition } from "../src/compose/composition.ts";
import { reportText } from "../src/shaping/accelReport.ts";

const src = (rel: string): string =>
	readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), "utf8");

/**
 * One exported function's own text.
 *
 * Both bodies are in the same module, so "the file mentions X" answers nothing
 * about which card renders X — which is exactly the confusion this split could
 * hide. Bounded by the next top-level `export`, which is how every body in that
 * file ends.
 */
function bodyOf(rel: string, name: string): string {
	const text = src(rel);
	const start = text.indexOf(`export function ${name}(`);
	assert.notEqual(start, -1, `${rel} has no exported ${name}`);
	const rest = text.slice(start + 1);
	const end = rest.indexOf("\nexport ");
	return end === -1 ? rest : rest.slice(0, end);
}

// ------------------------------------------------------------ the card exists

test("the accelerometer card is registered, titled, and placed on Settings", () => {
	assert.ok("accelerometers" in CARD_DEFS, "registered in CARD_DEFS");
	assert.equal(cardTitleOf("accelerometers"), "Accelerometers");
	assert.ok("accelerometers" in SETTINGS_COMPOSITION, "placed on the Settings screen");
	// Not shaping-branded, in id or in title — the point of the split is that
	// #47 can reach these two facts without going through the shaping feature.
	assert.doesNotMatch(String(CARD_DEFS.accelerometers.title), /shap/i);
	assert.doesNotMatch(CARD_DEFS.accelerometers.ariaLabel, /shap/i);
	// compose/cards.tsx is JSX and cannot be imported under node's type
	// stripping — the compiler already welds the halves (Record<CardId,
	// CardRender>), so reading the file is what shows the body is wired.
	// The key is a valid identifier, so the registry may spell it quoted or bare
	// — matching only one spelling would pin a style, not the wiring.
	assert.match(src("compose/cards.tsx"), /"?accelerometers"?:\s*\{ body: [^,]*<AccelerometersBody\b/);
});

/**
 * A card that is only reachable on one built-in screen is not a shared card.
 * Nothing special-cases this id anywhere, which is what makes it addable to a
 * custom screen through the ordinary picker — so the check is that the registry
 * knows it and the composition parser accepts it, the same two facts the picker
 * and the renderer read.
 */
test("the id is an ordinary registry card, addable anywhere", () => {
	const parsed = parseComposition({ accelerometers: { col: 0, row: 0, colSpan: 156, rowSpan: 60 } });
	assert.ok("accelerometers" in parsed, "parseComposition accepts it on any screen");
	assert.equal(BUILTIN_SCREENS.settings.name, "Settings");
});

// ---------------------------------------------------- the split actually moved

test("the sampling and address rows are on the new body and gone from ShapingBody", () => {
	const shaping = bodyOf("cards/SettingsCards.tsx", "ShapingBody");
	const accel = bodyOf("cards/SettingsCards.tsx", "AccelerometersBody");

	// Moved OUT. The four markers are the ones that only these two sections
	// have: the address input, the two sampling inputs, and the service the
	// pair is driven by.
	for (const gone of ["accel-addr", "accel-rate", "accel-bits", 'service("accel")']) {
		assert.ok(!shaping.includes(gone), `ShapingBody still carries ${gone}`);
	}
	// The caption, as the operator reads it. (The new body has no captions of
	// its own since #142 combined the rows — see below — so this only says the
	// section is gone from where it was.)
	assert.ok(!/set-cap">Sampling</.test(shaping), "ShapingBody still renders a Sampling section");

	// Moved IN, and complete: address, rate, resolution, the arming Set, and
	// the Read that asks the board.
	for (const kept of ["accel-addr", "accel-rate", "accel-bits", "setAccelRate", "readAccel"]) {
		assert.ok(accel.includes(kept), `AccelerometersBody is missing ${kept}`);
	}
});

test("ShapingBody keeps the envelope and the motion defaults, which are not sampling", () => {
	const shaping = bodyOf("cards/SettingsCards.tsx", "ShapingBody");
	// The envelope is the ONLY place one comes to exist (spec I8) and the
	// motion defaults describe the MOVE, not the sensor — MOTION_FIELDS is
	// shared with the Lab's Capture card under `one-motion-field-table`.
	assert.match(shaping, /set-cap">Envelope</);
	assert.match(shaping, /set-cap">Motion defaults</);
	assert.ok(shaping.includes("MOTION_FIELDS"), "the motion table stays with the run it parameterises");
	assert.ok(shaping.includes("commitEnvelope"), "the envelope editor stays");
});

// ------------------------------------------------- no second reader was created

test("the new body reports the shared verdicts rather than sentences of its own", () => {
	const accel = bodyOf("cards/SettingsCards.tsx", "AccelerometersBody");
	// The same two functions the old card was welded to (shaping/settingsDraft.ts).
	assert.match(accel, /accelStatusText\(judgeAccel\(/);
	// The board's own words for what it selected, not an echo of the fields.
	assert.match(accel, /reportText\(accelReport\(/);
	// And it never re-tests an address itself: parseAccelAddr is the sole
	// minting site and isAccelAddr is the gate's own predicate.
	assert.doesNotMatch(accel, /isAccelAddr/);
});

test("the new body reaches the accel service, not the Lab's", () => {
	const accel = bodyOf("cards/SettingsCards.tsx", "AccelerometersBody");
	assert.match(accel, /service\("accel"\)/);
	// GIT_126: the Settings screen is EAGER, and reaching the Lab's service from
	// here is what put 23 modules of shaping/** on every cold load.
	assert.doesNotMatch(accel, /service\("shaping"\)/);
});

// ---------------------------------------------- an existing operator gets it

/**
 * The saved-override path, for THIS id.
 *
 * Gabe's own `screens.layouts.settings` predates this card. #86 made absence in
 * an override mean "did not exist when I saved" rather than "I took it off", so
 * a coded card is ADDED — but that machinery is days old, and requirement 7
 * says exercise it rather than assume it. The override below is the coded
 * Settings composition as it stood before this change: every card that was
 * there, and nothing else.
 */
test("a Settings override saved before this card existed still gains it", () => {
	const preChange = { ...SETTINGS_COMPOSITION } as Record<string, unknown>;
	delete preChange["accelerometers"];
	const saved = parseComposition(preChange);
	assert.ok(!("accelerometers" in saved), "the fixture really is a pre-change override");

	const merged = mergeComposition(SETTINGS_COMPOSITION, saved, new Set());
	assert.ok("accelerometers" in merged, "a coded card absent from an override is added");
	// And the operator's own geometry for the cards they DID place survives —
	// otherwise "you get the new card" would be bought with a layout reset.
	assert.deepEqual(merged["settings-shaping"], saved["settings-shaping"]);
});

// ------------------------------------------------- the reserved slots persist

/**
 * POSITIONAL STABILITY, moved here with the rows it is about.
 *
 * Four tool rows that each gain and lose a sentence as replies arrive would
 * reflow the card on every Read. The reservation is a fixed-width span that is
 * NOT the message's own width, so which tool is unmapped cannot move the card's
 * width stop.
 */
test("the per-tool status slots are reserved, not conditional", () => {
	const css = src("app.css").replace(/\/\*[\s\S]*?\*\//g, "");
	const found = [...css.matchAll(/(^|[,}])\s*\.accel-status\s*\{([^}]*)\}/g)];
	assert.ok(found.length > 0, "no rule for .accel-status");
	const body = found[found.length - 1]![2]!;
	// A FIXED PREFERENCE, not a fixed size (#142). `flex: 0 0` with nowrap put
	// the whole sentence into the card's min-content probe; `flex: 0 1` with a
	// u-multiple basis keeps the box the same width speaking or silent while
	// costing nothing in the floor. The shape of the remedy is checked once,
	// for every slot that carries it, in intrinsic-floors.test.ts — this only
	// pins that the slot is still RESERVED rather than content-sized.
	assert.match(body, /flex:\s*0 1 calc\(/);
	assert.match(body, /height:\s*var\(--ctl-h\)/);
});

// -------------------------------------------------- one row per tool (#142)

/**
 * ONE ROW PER TOOL, not two.
 *
 * Gabe, 2026-08-28: "accelerometers card should have the rows combined, no need
 * for 8 rows, each set of 4 tools twice". #140 shipped the card as an Address
 * section and a Sampling section, each with a row per tool, so the tool — the
 * thing the operator is looking for — was the one thing said twice.
 *
 * Counted as `.field` rows inside ONE `<For>`, because the defect was two
 * loops, not two rows.
 */
test("the card renders one field row per tool, not one per tool per section", () => {
	const accel = bodyOf("cards/SettingsCards.tsx", "AccelerometersBody");
	assert.equal([...accel.matchAll(/<For each=\{app\.om\.om\.tools\}/g)].length, 1,
		"two loops over the tools is the eight-row card");
	assert.equal([...accel.matchAll(/<div class="field">/g)].length, 1,
		"one row template, carrying both halves");
	assert.equal([...accel.matchAll(/class="field-label"/g)].length, 1,
		"the tool is named once per row");
	// The section captions go with the sections. One group needs no heading —
	// the card's title is what names it.
	assert.doesNotMatch(accel, /set-cap/, "a caption over a single list is a heading for nothing");
});

/**
 * NOTHING WAS DROPPED BY THE MERGE. Enumerated, because "combine the rows" is
 * exactly the kind of change that quietly loses a control.
 */
test("every control from both former sections is on the combined row", () => {
	const accel = bodyOf("cards/SettingsCards.tsx", "AccelerometersBody");
	for (const kept of [
		"accel-addr", // the address field
		"commitAccel", // ...committed on change/Enter
		"accelStatusText(judgeAccel(", // ...and its verdict
		"accel-rate", // the sample rate
		"accel-bits", // the resolution
		"shp-arming", // the arming Set -> Confirm
		"applyRate",
		"readAccel", // the Read that asks the board
		"reportText(accelReport(", // ...and the board's own reply
	]) {
		assert.ok(accel.includes(kept), `the combined row lost ${kept}`);
	}
	// Both reserved slots survive as separate slots. Folding them into one
	// would need a precedence rule for the case where both have something to
	// say, and inventing that rule is this card deciding something.
	assert.equal([...accel.matchAll(/accel-status/g)].length, 2,
		"the verdict and the board's reply stay two reserved slots");
});

/**
 * THE SILENT SLOT IS LAST IN THE ROW, and this is the whole of Gabe's second
 * report: "the new accelerometer card has a huge artificial blank between input
 * field columns 1 and 2".
 *
 * A reserved slot has to satisfy three things at once — invisible when silent,
 * immobile when it speaks, and absent from the card's min-content. Last in the
 * row is the only position where all three hold: the space it reserves when
 * empty is indistinguishable from the row's own trailing space.
 *
 * The claim rests on the OTHER slot never being the silent one, so that is
 * asserted directly below rather than assumed.
 */
test("the slot that can be empty is the last thing in the row", () => {
	const accel = bodyOf("cards/SettingsCards.tsx", "AccelerometersBody");
	const reply = accel.indexOf("accel-status accel-reply");
	const verdict = accel.indexOf(`accel-status${"$"}{accelStatus`);
	assert.notEqual(reply, -1, "the board-reply slot is missing");
	assert.notEqual(verdict, -1, "the address-verdict slot is missing");
	assert.ok(verdict > reply, "the verdict — the slot that is empty when all is well — must come last");
	// And after every control, not merely after the other slot.
	for (const control of ["accel-addr", "accel-rate", "accel-bits", "readAccel"]) {
		assert.ok(accel.indexOf(control) < verdict, `${control} must come before the silent slot`);
	}
});

test("reportText is never empty, which is why it may sit before the silent slot", () => {
	// Every arm: nothing read yet, an unparseable empty reply, an unparseable
	// non-empty reply, and a parsed one.
	assert.notEqual(reportText(null), "");
	assert.notEqual(reportText({ known: false, raw: "" }), "");
	assert.notEqual(reportText({ known: false, raw: "??" }), "");
	assert.notEqual(reportText({ known: true, raw: "", sampleRateHz: 1344, bits: 10, sensor: "LIS3DH" }), "");
});
