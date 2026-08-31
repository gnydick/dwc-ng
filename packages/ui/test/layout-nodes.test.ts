/**
 * Layout-node geometry rules (GIT_194 inc 3, round 2) — found by Gabe driving
 * the mock on 2026-08-31, both on the UAT-2 demo card:
 *
 *   1. TOUCHING STACK. The columns node and the macro row are TOP-LEVEL
 *      siblings, and ControlList rendered its nodes as a bare <For> straight
 *      into `.panel-body` — no container, no gap — so "Motors off" (bottom of
 *      the split) sat flush against "Run" (the row below): two controls
 *      touching. Every OTHER stacking level already carried the house gap
 *      (`.ctl-col`/`.ctl-group`: `gap: var(--ctl-gap)`), and rows carry the
 *      SAME token horizontally (`.ctl-wrap { gap: var(--ctl-gap) }`), so the
 *      root was the one level with no rhythm. The fix is a root container
 *      owned by ControlList itself — `.ctl-list`, one choke point for every
 *      mount (custom cards, studio preview, built-ins) — with the same token.
 *      A mount with its OWN layout (the Movement card's `.jog-controls` grid)
 *      REPLACES the class, the `node.class ?? "ctl-group"` precedent, so its
 *      grid still owns the direct children.
 *
 *   2. CROSS-AXIS STRETCH. `.ctl-col`/`.ctl-group` declared
 *      `align-items: stretch`, so a BUTTON in a column rendered rule-to-edge
 *      ("motors off… left pinned to the vertical rule, right edge pinned to
 *      the right side of the card") and grew with every resize. A control
 *      atom must keep its intrinsic width — rows already treat buttons that
 *      way (a row's cross axis is vertical; buttons take their own width).
 *      Stacks now default to `align-items: flex-start`, and the elements that
 *      ARE layout (row, columns, grid, nested group) plus the deliberately
 *      elastic slider strip (its range input declares its own min/max caps —
 *      the GIT_144 rule) span the stack via `align-self: stretch`. A
 *      per-container "stretch" knob was considered and NOT minted (YAGNI —
 *      recorded as an open extension in the layout-nodes spec).
 *
 * Source assertions over app.css + the two TSX mounts, the intrinsic-floors
 * pattern: they cannot prove the geometry is right (the UAT probe drives
 * that), but they stop either rule being deleted or detached silently.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const appCss = stripComments(
	readFileSync(fileURLToPath(new URL("../src/app.css", import.meta.url)), "utf8"),
);
const indexCss = stripComments(
	readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8"),
);

/** Every rule block, selector list intact. */
const rules = (): Array<{ sel: string; body: string }> =>
	[...appCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1]!.trim(), body: m[2]! }));

/** Selector-list split that does NOT split inside :is()/:where() parens —
 *  a naive split(",") reads `:is(.a, .b) > .c` as a rule for bare `.b`. */
const splitSelectors = (list: string): string[] => {
	const out: string[] = [];
	let depth = 0;
	let cur = "";
	for (const ch of list) {
		if (ch === "(") depth += 1;
		if (ch === ")") depth -= 1;
		if (ch === "," && depth === 0) {
			out.push(cur.trim());
			cur = "";
		} else cur += ch;
	}
	out.push(cur.trim());
	return out;
};

const panelCanvas = readFileSync(
	fileURLToPath(new URL("../src/shell/panelCanvas.ts", import.meta.url)), "utf8");

/** Every .ts/.tsx under a directory. Used by the choke-point pin below, which
 *  is a claim about the WHOLE source tree and cannot be made by naming files:
 *  the wearer it has to catch is the one nobody has written yet. */
const sourceFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap(e =>
		e.isDirectory() ? sourceFiles(join(dir, e.name))
			: /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);

/** The LAST rule whose selector list contains exactly `sel`. */
const ruleFor = (sel: string): { sel: string; body: string } => {
	const found = rules().filter(r => splitSelectors(r.sel).some(s => s === sel));
	assert.ok(found.length > 0, `no rule for ${sel}`);
	return found[found.length - 1]!;
};

test("one gap token, every stacking level: root list, column, group — and rows horizontally", () => {
	// The token itself: the house inter-control gap, 2u, defined once.
	assert.match(indexCss, /--ctl-gap:\s*calc\(2\s*\*\s*var\(--u\)\)/,
		"--ctl-gap is no longer the 2u house token this file cites");
	// Rows use it horizontally (the value the round-2 brief asked to be cited)…
	assert.match(ruleFor(".ctl-wrap").body, /gap:\s*var\(--ctl-gap\)/,
		"rows lost the token — the vertical counterpart below would then drift from them");
	// …and every vertical stack uses the SAME token: the root list included.
	for (const sel of [".ctl-list", ".ctl-col", ".ctl-group"]) {
		assert.match(ruleFor(sel).body, /gap:\s*var\(--ctl-gap\)/,
			`${sel} does not carry gap: var(--ctl-gap) — controls in this stack can render touching`);
	}
});

test("ControlList owns a root container; a mount's own layout class REPLACES it", () => {
	const list = readFileSync(
		fileURLToPath(new URL("../src/compose/controls/ControlList.tsx", import.meta.url)), "utf8");
	assert.match(list, /class=\{props\.class \?\? "ctl-list"\}/,
		"ControlList renders no root container — top-level nodes land in .panel-body with no gap (the touching-stack defect)");

	const cards = readFileSync(
		fileURLToPath(new URL("../src/compose/cards.tsx", import.meta.url)), "utf8");
	assert.match(cards, /<ControlList spec=\{MOVEMENT_SPEC\} ctx=\{ctx\} class="jog-controls"/,
		"the Movement card must hand its grid class THROUGH the list root");
	assert.doesNotMatch(cards, /<div class="jog-controls">/,
		"a wrapper div around ControlList puts the root list INSIDE the grid — the grid then lays out one child");
});

test("control atoms keep intrinsic width in a stack; layout containers span it", () => {
	// The stacks: no stretch default anywhere.
	for (const sel of [".ctl-list", ".ctl-col", ".ctl-group"]) {
		const body = ruleFor(sel).body;
		assert.match(body, /align-items:\s*flex-start/,
			`${sel} does not default its cross axis to flex-start — a button in it stretches with the card`);
		assert.doesNotMatch(body, /align-items:\s*stretch/,
			`${sel} still declares align-items: stretch — the Motors-off defect`);
	}
	// The elements that ARE layout span the stack. One rule; every stack
	// container and every spanning child named in it, so adding a stack (or a
	// container node) without deciding its cross-axis behaviour fails here.
	// Coverage is asserted on the PARSED :is() argument lists, token by token,
	// never by substring: `.ctl-col` is a substring of `.ctl-columns` and
	// `.ctl-group` also sits in the CHILD list, so a `sel.includes(...)` read
	// stayed green with either dropped from the PARENT list (F2, review of
	// 66b9bd2 — the aliasing the paren-aware splitter above exists to stop).
	const span = rules().find(r =>
		/align-self:\s*stretch/.test(r.body) && r.sel.includes(".ctl-list") && r.sel.includes(".ctl-wrap"));
	assert.ok(span !== undefined,
		"no rule stretches layout containers inside the stacks — rows/columns would shrink-wrap and their spacers stop distributing");
	const shape = /^:is\(([^)]*)\)\s*>\s*:is\(([^)]*)\)$/.exec(span!.sel);
	assert.ok(shape !== null,
		`the spanning rule is not the parent :is() > child :is() form this test knows how to read: ${span!.sel}`);
	const parents = splitSelectors(shape![1]!);
	const children = splitSelectors(shape![2]!);
	for (const cls of [".ctl-list", ".ctl-col", ".ctl-group"]) {
		assert.ok(parents.includes(cls),
			`the spanning rule's PARENT list does not name ${cls} — layout children of that stack shrink-wrap`);
	}
	for (const child of [".ctl-wrap", ".ctl-columns", ".ctl-grid", ".ctl-group", ".ctl-slider"]) {
		assert.ok(children.includes(child), `${child} is layout (or an elastic strip) and must span the stack`);
	}
});

/**
 * F1 (review of 66b9bd2) — A ROOT-LEVEL FLEXIBLE SPACER MUST HAVE FREE SPACE,
 * AND THE ROW FLOOR MUST NOT SEE IT.
 *
 * `{ "type": "spacer" }` at the top level of a spec is valid vocabulary
 * (parse.ts reaches the spacer case from the root nodes walk) and is the
 * footer idiom: content, spacer, footer row pinned to the card's bottom.
 * Before .ctl-list existed the root nodes were direct children of
 * `.panel-body` (flex column, definite height via flex: 1), so the spacer
 * had free space to eat. Wrapping them in a content-height `.ctl-list`
 * silently made every root spacer inert: valid vocabulary, no effect.
 *
 * Restoring the semantics is `.ctl-list { flex: 1 0 auto }` — but a body
 * child with flex-grow > 0 is a SLACK ABSORBER to contentRowSpan
 * (shell/panelCanvas.ts), measured at its declared min-height (else zero),
 * so the grow alone would floor every control card at header + padding.
 * The pair that keeps both true is the measuring-intrinsic construction,
 * on the vertical axis: contentRowSpan — the ONE vertical measurement
 * route — wears `measuring-rows` on the body for its synchronous read, and
 * app.css collapses the list back to content height under that class. The
 * grows check then reads flex-grow 0 and the rendered height IS the true
 * minimum, with the spacer at its zero basis.
 *
 * Three parts, none visible from the others, held together here — the
 * ratio-zero/lift/wearer pattern from intrinsic-floors.test.ts.
 */
test("a root-level flexible spacer has free space to distribute, and the floor cannot see it", () => {
	// 1. The grow: without it a root spacer is inert (the F1 defect).
	const list = ruleFor(".ctl-list").body;
	const grow = /flex:\s*([\d.]+)/.exec(list);
	assert.ok(grow !== null && Number(grow[1]) >= 1,
		".ctl-list does not grow in .panel-body — a root-level flexible spacer has no free space and the footer idiom renders flush under the content");
	// …and the spacer itself is still the free-space eater the idiom rides on.
	assert.match(ruleFor(".ctl-spacer").body, /flex:\s*1 1 0/,
		".ctl-spacer lost its flexible default — nothing distributes the space the grow above provides");

	// 2. The collapse: under measurement the list is content height again.
	const collapse = rules().find(r =>
		splitSelectors(r.sel).some(s => s === ".measuring-rows .ctl-list"));
	assert.ok(collapse !== undefined,
		"no .measuring-rows .ctl-list rule — contentRowSpan measures a growing list at min-height 0 and every control card's floor collapses to header + padding");
	assert.match(collapse!.body, /flex:\s*0 0 auto/,
		"the measurement rule does not collapse the grow — the floor still cannot see the content");

	// 3. The wearer: contentRowSpan's own child loop runs inside the mode.
	const fn = /\bfunction contentRowSpan[\s\S]*?\n\}/.exec(panelCanvas);
	assert.ok(fn !== null, "contentRowSpan not found in panelCanvas.ts — the vertical measurer moved; move this pin with it");
	// The slice above is a regex over source and degrades QUIETLY if the
	// function is ever moved into a class or an object literal (the closing
	// `\n}` would then land somewhere else). These two anchors make that
	// degradation loud: they are the first and last statements of the real
	// function, so a slice that lost either is a slice this test must not go
	// on reasoning about.
	assert.match(fn![0]!, /querySelector<HTMLElement>\("\.panel-body"\)/,
		"the contentRowSpan slice does not start at the real function — this pin is reading the wrong text");
	assert.match(fn![0]!, /return Math\.max\(1,/,
		"the contentRowSpan slice does not reach the function's return — the source shape moved and the assertions below are vacuous");
	const enter = fn![0]!.indexOf('measureUnder(body, "measuring-rows"');
	const loop = fn![0]!.indexOf("for (const child");
	assert.ok(enter !== -1,
		"contentRowSpan never enters measuring-rows — a growing .ctl-list is measured as a slack absorber and reports zero");
	assert.ok(enter < loop,
		"measuring-rows must be entered BEFORE the child loop — entered after, the loop still reads the growing list");
});

/**
 * F4 (review of 3248aed) — THE MEASUREMENT MODES COME OFF HOWEVER THE READ
 * ENDS, AND THERE IS EXACTLY ONE PLACE THAT TAKES THEM OFF.
 *
 * Both wearers were a bare `classList.add(…)` … read … `classList.remove(…)`
 * pair with no `try/finally` — contentRowSpan with `measuring-rows`, and
 * intrinsicWidthPx with `measuring-intrinsic`, the same shape twice, which is
 * the tripwire that says the design was already wrong. A throw between the two
 * lines leaves the class stuck on that card's body for the life of the page:
 * `.ctl-list` permanently loses the grow a root spacer needs (silently
 * re-creating the F1 defect on one card), or that card's columns stop being
 * pure ratio tracks. Neither paints as an error.
 *
 * The fix is a choke point, not two more `finally`s: `measureUnder` is the one
 * add/remove site, the mode names are a closed union (a misspelt class is a
 * mode that silently does nothing, so it is now a compile error), and it is
 * nesting-safe because `classList` is a set and not a counter.
 */
test("a measurement mode is only ever worn through the exception-safe choke point", () => {
	const helper = /export function measureUnder[\s\S]*?\n\}/.exec(panelCanvas);
	assert.ok(helper !== null, "measureUnder is gone — nothing guarantees a measurement class comes off");
	assert.match(helper![0]!, /try\s*\{[\s\S]*\}\s*finally\s*\{[\s\S]*classList\.remove/,
		"measureUnder does not remove the class in a finally — a throw mid-measurement strips a card's layout for good");

	// measureUnder toggles the class by its PARAMETER, so the choke point can be
	// stated as an absolute over the whole tree: nowhere in src does anything
	// add or remove a measurement class by NAME. A hand-written wearer — the
	// shape both defects had — is a literal, and fails here wherever it is put,
	// including in this file's own module.
	assert.match(helper![0]!, /classList\.add\(mode\)/,
		"measureUnder no longer adds the mode it was given");
	assert.match(helper![0]!, /classList\.remove\(mode\)/,
		"measureUnder no longer removes the mode it was given");
	const offenders: string[] = [];
	for (const file of sourceFiles(fileURLToPath(new URL("../src", import.meta.url)))) {
		for (const m of readFileSync(file, "utf8").matchAll(/classList\.(?:add|remove)\(\s*"measuring-[\w-]+"/g)) {
			offenders.push(`${file.split(/[\\/]/).pop()}: ${m[0]}`);
		}
	}
	assert.deepEqual(offenders, [],
		`a measurement mode is worn by hand instead of through measureUnder, so that copy has no finally: ${offenders.join(", ")}`);

	// F3 (same review): the audit's drift sampler reads the SAME flex-grow
	// signal for the SAME meaning and did not wear the mode, so `.ctl-list`
	// read as a filler, growPrefix cut the row-axis window to the header alone,
	// and Invariant B — the project's positional-stability check — reported
	// "stable" over a window it was no longer measuring. The claim that
	// contentRowSpan was "the ONE vertical measurement route" was asserted, not
	// enumerated, and this is the instance that falsified it.
	const audit = readFileSync(
		fileURLToPath(new URL("../src/dev/LayoutAuditPanel.tsx", import.meta.url)), "utf8");
	const sampler = /function sampleChildren[\s\S]*?\n\}/.exec(audit);
	assert.ok(sampler !== null, "sampleChildren not found — the drift sampler moved; move this pin with it");
	assert.match(sampler![0]!, /measureUnder\(body, "measuring-rows"[\s\S]*?flexGrow/,
		"sampleChildren reads flex-grow outside the row truth mode — a growing .ctl-list truncates growPrefix and the drift check silently shrinks to the header");
});

/**
 * F2 (review of 3248aed) — A VOCABULARY CLASS DECLARES flex-grow ONLY WHERE
 * THE CONTAINER'S MAIN AXIS IS THE AXIS THE GROW WAS WRITTEN FOR.
 *
 * `flex-grow` is axis-blind: it follows whatever main axis the PARENT runs, so
 * a grow written for a row also fires in a stack. That was harmless while
 * `.ctl-list` was content height and became a defect the moment it grew:
 * `.ctl-slider` carried `flex: 1` on the ATOM, `slider` is valid ROOT
 * vocabulary (parse.ts walks root `nodes` through the same validateNode), so a
 * card whose spec is `nodes: [{type:"slider"}]`, placed taller than its
 * content, drew its slider floating in the VERTICAL MIDDLE of an otherwise
 * empty card. No built-in was affected — the blast radius was exactly the
 * user-authored Card Lab specs this vocabulary exists to serve.
 *
 * The allowlist below is the enforcement, not the documentation: this test is
 * the reason `.ctl-list`'s comment can still say a card without a root spacer
 * renders as before. It is a SOURCE-SEMANTIC pin, not a rendered one — this
 * suite is `node --test` with no DOM and no layout engine, so nothing here
 * measures a pixel. What it does catch is the defect's actual shape: a
 * `.ctl-*` rule that grows without naming the container it grows in.
 */
test("every .ctl-* flex-grow is main-axis-honest — scoped to a row, or a spacer", () => {
	// grow from either spelling. `flex: <n>` and `flex-grow: <n>`; the
	// keywords resolve to `flex: 0 1 auto` (initial/none) or `1 1 auto` (auto).
	const growOf = (body: string): number => {
		const explicit = /(?:^|;)\s*flex-grow\s*:\s*([\d.]+)/.exec(body);
		if (explicit) return Number(explicit[1]);
		const shorthand = /(?:^|;)\s*flex\s*:\s*([^;]+)/.exec(body);
		if (!shorthand) return 0;
		const value = shorthand[1]!.trim();
		if (value === "auto") return 1;
		if (value === "none" || value === "initial") return 0;
		return Number.parseFloat(value) || 0;
	};

	// Every selector allowed to grow, WITH the reason it is honest. A new
	// grow-bearing `.ctl-*` rule fails here until someone writes its reason,
	// which is the point: the failure asks the question the defect skipped.
	const honest: Record<string, string> = {
		".ctl-spacer": "the node whose whole purpose is eating slack — main-axis on either axis, deliberately",
		".ctl-list": "grows in .panel-body (a column) so a ROOT spacer has free space; its own children pack to the top",
		".ctl-wrap > .ctl-slider": "scoped to the vocabulary's only ROW container, where the main axis really is horizontal",
		".ctl-slider .ctl-range-input": "inside .ctl-slider, which is itself a row — the track fills it",
	};

	const growers = rules()
		.filter(r => growOf(r.body) > 0)
		.flatMap(r => splitSelectors(r.sel))
		.filter(sel => /(?:^|[\s>+~(])\.ctl-/.test(sel));
	assert.ok(growers.length > 0, "no .ctl-* rule grows at all — this pin is reading the wrong file");
	for (const sel of growers) {
		assert.ok(honest[sel] !== undefined,
			`.ctl-* rule "${sel}" declares flex-grow with nothing saying which axis it grows on. `
			+ "flex-grow follows the CONTAINER's main axis, and every one of these classes can be placed in a "
			+ "COLUMN (root, .ctl-col, .ctl-group) as well as a row — scope it to the row container, or add it "
			+ `to the allowlist in this test with the reason it is honest. Allowed: ${Object.keys(honest).join(", ")}`);
	}
	// …and the specific regression: the strip's grow is not on the atom.
	assert.equal(growOf(ruleFor(".ctl-slider").body), 0,
		".ctl-slider declares flex-grow on the ATOM again — a root-level slider is then a growing item of the growing .ctl-list and floats in the middle of its card");
	assert.ok(growers.includes(".ctl-wrap > .ctl-slider"),
		"nothing grows the slider inside a row any more — a row's slider stopped filling it");
});

test("the mock's seeded demo card compiles whole and exercises the round-2 shapes", async t => {
	// Defect 3 of the round (the demo-card re-author): the mock's seeded
	// "Beeper" card is the card a fresh mock hands Gabe to drive, so it must
	// (a) compile through the ONE spec boundary — the mock is zero-dep and
	// cannot run this compiler itself, so a vocabulary change that
	// invalidates the seed would otherwise surface as a broken card on the
	// mock, not a red test — and (b) hold exactly the shape both round-2
	// defects appeared in, so driving the seed exercises the fixes: a
	// columns split and a row as TOP-LEVEL siblings (the root-stack gap),
	// with a button stacked inside a column (the intrinsic-width case).
	// Downloaded from a live in-process mock, not re-read from its source:
	// what this pins is the spec the mock actually SERVES.
	const { startMock } = await import("../../mock-duet/test/helpers.ts");
	const { parseControlSpecText } = await import("../src/compose/controls/parse.ts");
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();
	const down = await mock.getRaw("rr_download?name=0:/sys/dwc-ng-config.json", key);
	const config = JSON.parse(await down.text()) as {
		overlay: {
			cards: Record<string, { name: string; spec: string; colSpan: number; rowSpan: number }>;
			screens?: { layouts?: Record<string, unknown> };
		};
	};

	// PLACED, not merely defined — the check nobody ran (review of 3248aed).
	// `overlay.cards` is the REGISTRY; a custom card renders only where a
	// screen's composition names it, so a seed that defines Beeper and places
	// it nowhere serves a mock on which the card is invisible until a human
	// ticks it in edit mode. That is what happened, and the whole reason the
	// card is seeded — a fresh mock that DEMONSTRATES the vocabulary — was
	// silently void for it.
	//
	// Read through parseComposition, not off the JSON: that is the boundary
	// the placement actually crosses (custom-id guard + clampRect), so this
	// asserts the rect the renderer would get rather than the bytes on the SD.
	const { parseComposition } = await import("../src/compose/composition.ts");
	const known = new Set(Object.keys(config.overlay.cards));
	const placed = Object.values(config.overlay.screens?.layouts ?? {})
		.flatMap(raw => Object.entries(parseComposition(raw, known)));
	for (const [id, card] of Object.entries(config.overlay.cards)) {
		const slot = placed.find(([sid]) => sid === id)?.[1];
		assert.ok(slot !== undefined,
			`seeded card "${card.name}" (${id}) survives no screen's composition — a fresh mock renders it nowhere`);
		// Placed with SLACK, deliberately above the authored footprint: the
		// footer idiom is the thing this card demonstrates, and a card at its
		// own content height has no free space for a root spacer to distribute.
		assert.ok(slot!.rowSpan > card.rowSpan,
			`"${card.name}" is placed at ${slot!.rowSpan} rows against an authored ${card.rowSpan} — a flexible root spacer shows nothing without slack`);
	}

	const cards = Object.values(config.overlay.cards);
	assert.ok(cards.length > 0, "the seed carries at least one custom card");
	for (const card of cards) {
		const parsed = parseControlSpecText(card.spec);
		assert.equal(parsed.ok, true,
			`seeded card "${card.name}" does not compile: ${parsed.ok ? "" : parsed.error}`);
	}

	const beeper = cards.find(c => c.name === "Beeper");
	assert.ok(beeper !== undefined, "the Beeper demo card is seeded");
	const parsed = parseControlSpecText(beeper!.spec);
	assert.ok(parsed.ok);
	const nodes = parsed.spec.nodes;
	assert.equal(nodes[0]!.type, "columns", "top-level sibling 1 is the columns split");
	// The F1 idiom, seeded so it is DRIVABLE: a flexible root spacer between
	// the content and the footer row. Driving the seed shows the Pitch row
	// pinned to the card's bottom edge — the behaviour the .ctl-list grow
	// restores and the "root-level flexible spacer" test above holds up.
	const spacer = nodes[1]!;
	assert.equal(spacer.type, "spacer", "a flexible ROOT spacer separates content from the footer row");
	assert.ok(spacer.type !== "spacer" || spacer.size === undefined,
		"the root spacer must be FLEXIBLE — a fixed size never exercises the free-space path");
	assert.equal(nodes[2]!.type, "row", "the footer row the root spacer pins to the card's bottom");
	const cols = nodes[0]!.type === "columns" ? nodes[0]!.columns : [];
	assert.ok(
		cols.some(col => col.nodes.some(n => n.type === "gcode-button")),
		"a button sits directly in a column — the atom the flex-start default keeps at intrinsic width",
	);
});
