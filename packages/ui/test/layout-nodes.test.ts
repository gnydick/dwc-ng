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
import { readFileSync } from "node:fs";
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

	// 3. The wearer: inside contentRowSpan itself, not a caller — the sole
	// vertical measurement route is the choke point (the intrinsicWidthPx
	// precedent), added BEFORE the child loop reads and removed after.
	const canvas = readFileSync(
		fileURLToPath(new URL("../src/shell/panelCanvas.ts", import.meta.url)), "utf8");
	const fn = /export function contentRowSpan[\s\S]*?\n\}/.exec(canvas);
	assert.ok(fn !== null, "contentRowSpan not found in panelCanvas.ts — the sole vertical measurer moved; move this pin with it");
	const add = fn![0]!.indexOf('classList.add("measuring-rows")');
	const remove = fn![0]!.indexOf('classList.remove("measuring-rows")');
	const loop = fn![0]!.indexOf("for (const child");
	assert.ok(add !== -1,
		"contentRowSpan never enters measuring-rows — a growing .ctl-list is measured as a slack absorber and reports zero");
	assert.ok(remove !== -1,
		"measuring-rows is never left — live rendering would lose the grow the root spacer needs");
	assert.ok(add < loop && loop < remove,
		"measuring-rows must be worn around the child loop — worn elsewhere, the loop still reads the growing list");
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
		overlay: { cards: Record<string, { name: string; spec: string }> };
	};

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
