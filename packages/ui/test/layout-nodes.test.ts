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
	const span = rules().find(r =>
		/align-self:\s*stretch/.test(r.body) && r.sel.includes(".ctl-list") && r.sel.includes(".ctl-wrap"));
	assert.ok(span !== undefined,
		"no rule stretches layout containers inside the stacks — rows/columns would shrink-wrap and their spacers stop distributing");
	for (const cls of [".ctl-list", ".ctl-col", ".ctl-group"]) {
		assert.ok(span!.sel.includes(cls), `the spanning rule does not cover children of ${cls}`);
	}
	for (const child of [".ctl-wrap", ".ctl-columns", ".ctl-grid", ".ctl-group", ".ctl-slider"]) {
		assert.ok(span!.sel.includes(child), `${child} is layout (or an elastic strip) and must span the stack`);
	}
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
	assert.equal(nodes[1]!.type, "row", "top-level sibling 2 is a row — the pair the .ctl-list gap keeps apart");
	const cols = nodes[0]!.type === "columns" ? nodes[0]!.columns : [];
	assert.ok(
		cols.some(col => col.nodes.some(n => n.type === "gcode-button")),
		"a button sits directly in a column — the atom the flex-start default keeps at intrinsic width",
	);
});
