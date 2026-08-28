import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * WHERE A CARD'S SLACK GOES, asserted against the stylesheet source.
 *
 * A card is almost always taller than its content: `rowSpan` is a stored grid
 * pin, the content is whatever the machine is reporting this second. The
 * difference has to go somewhere, and for a while it went ABOVE the content —
 * `.panel-body > .card-head { margin-bottom: auto }`, under a section headed
 * "card contents sit at the BOTTOM". Reported by Gabe on 2026-08-28 against the
 * Shaping card (#128): expand a tool row, drag the card taller to fit it,
 * collapse the row again, and the table that had sat 129px down the body was
 * now 249px down it — the content had been pushed down by the card's own free
 * space, and the tail never moved at all because it was anchored to the bottom.
 * Growth was linear and unbounded: three +150px probes moved every child down
 * 150px each.
 *
 * That is `no-child-drift-on-resize` (Invariant B, src/dev/layoutAudit.ts:165)
 * failing on the row axis, on every card in the registry at once — the selector
 * is unqualified and Panel.tsx:107 puts a `.card-head` in every panel, so the
 * affected set was "every card ever taller than its content".
 *
 * There is no DOM harness in this workspace (no jsdom / happy-dom / linkedom /
 * puppeteer / playwright in any package.json or in pnpm-lock.yaml), so nothing
 * here can mount a body and click a disclosure. What CAN be held automatically
 * is the MECHANISM: a flex column with no auto margins and no `justify-content`
 * packs to flex-start, and then there is no declaration in the stylesheet
 * capable of placing free space above a card's content. These assertions are
 * what stops the rule being written back — which is the only way the defect can
 * return, since it cannot be reached by writing card markup.
 */

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const appCss = stripComments(
	readFileSync(fileURLToPath(new URL("../src/app.css", import.meta.url)), "utf8"),
);

/** The declaration block of the LAST rule whose selector list contains `sel`.
 *  Same scanner shape as intrinsic-floors.test.ts — comments already stripped,
 *  so a declaration quoted inside a comment cannot satisfy or break a check. */
function ruleBody(sel: string): string {
	const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const found = [...appCss.matchAll(new RegExp(`(^|[,}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))];
	assert.ok(found.length > 0, `no rule for ${sel}`);
	return found[found.length - 1]![2]!;
}

/**
 * EVERY declaration block whose selector list names `sel`, concatenated.
 *
 * Not the last one, unlike ruleBody: the two fixed regions share ONE block for
 * the three declarations that must be identical between them and take their
 * declared height in a rule of their own. Asking "what is in effect for this
 * region" rather than "what is in this one block" is what lets the shared block
 * exist while still failing if a new region is declared only halfway.
 */
function declarationsFor(sel: string): string {
	const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const found = [...appCss.matchAll(new RegExp(`(^|[,}])\\s*${escaped}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`, "g"))];
	assert.ok(found.length > 0, `no rule for ${sel}`);
	return found.map(m => m[2]!).join(";");
}

/** As ruleBody, but an ABSENT rule yields "" instead of failing. Used where the
 *  rule was deleted outright and its absence is the thing being asserted. */
function optionalRuleBody(sel: string): string {
	const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const found = [...appCss.matchAll(new RegExp(`(^|[,}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))];
	return found.length === 0 ? "" : found[found.length - 1]![2]!;
}

/** Every rule in the sheet, as [selector list, declaration block]. */
function allRules(): Array<[string, string]> {
	return [...appCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.map(m => [m[1]!.trim(), m[2]!] as [string, string]);
}

/* ---------- T1: slack has one place to go, and it is not above content ---- */

test("the card header declares no auto bottom margin — slack must not sit above content", () => {
	// Optional by design: the rule was DELETED, not emptied, so "no such rule"
	// is the passing state and must not read as a broken scanner.
	const head = optionalRuleBody(".panel-body > .card-head");
	assert.doesNotMatch(head, /margin-bottom:\s*auto/,
		"an auto bottom margin on the head absorbs the card's free space ABOVE the body, "
		+ "which pushes every card's top content down as the card grows (#128)");
});

test("--absorbs-slack is gone from the sheet, because there is no slack above content to mark", () => {
	// The custom property existed only to tell contentRowSpan to discount the
	// head's auto margin. With no auto margin there is nothing to discount, and
	// a marker nobody sets is a rung-0 invitation to set one.
	assert.doesNotMatch(appCss, /--absorbs-slack/,
		"the marker outlived the margin it described — delete it rather than leave it as a route back");
});

test(".panel-body declares no justify-content other than flex-start", () => {
	// Forbidden for a reason already learned and recorded at app.css:4247:
	// .panel-body is a SCROLL container, and `justify-content: flex-end` sends
	// its overflow off the TOP where scrollTop cannot reach it. Reported on
	// Sensors in portrait. The auto margin is being deleted today; this keeps
	// the OTHER route to the same defect closed at the same time.
	const body = ruleBody(".panel-body");
	const jc = body.match(/justify-content:\s*([\w-]+)/);
	if (jc) assert.equal(jc[1], "flex-start", "the body's overflow escapes upward under anything else");
});

test("no rule touching .panel-body or .card-head declares a vertical auto margin", () => {
	// (c): the general form. Either selector, either margin, anywhere in the
	// sheet — including a narrow-viewport override, which is where the last
	// version of this idea would most plausibly be reintroduced.
	const offenders = allRules()
		.filter(([sel]) => sel.includes(".panel-body") || sel.includes(".card-head"))
		.filter(([, body]) => /margin-(top|bottom):\s*auto/.test(body) || /margin:\s*[^;]*\bauto\b/.test(body))
		.map(([sel]) => sel);
	assert.deepEqual(offenders, [],
		"a vertical auto margin here re-creates #128: it absorbs the card's free space "
		+ "into the column and moves the content that sits after it");
});

/* ---------- T2: a fixed region's four declarations travel together --------- */

/**
 * A region whose height is DECLARED rather than derived. Four declarations, and
 * all four are load-bearing:
 *
 *   flex: 0 0 auto      — .panel-body is a flex column, so without it the box
 *                         SHRINKS with the card and contentRowSpan (which sums
 *                         children's own heights) reports a floor that tracks
 *                         the card's current height. That is the Invariant A
 *                         hysteresis defect; 23 cells of spread measured on
 *                         .shp-scroll before the rule, 2026-08-22.
 *   max-height in u     — a raw px height would not scale with --u, and
 *                         test/unit-lengths.test.ts fails the suite for it.
 *   overflow-y: auto    — what makes the extra row a scroll target instead of
 *                         a reason for the card to grow.
 *   scrollbar-width     — a classic scrollbar is ~15 SCREEN px whatever --u is,
 *                         so it enters the card's min-content width as a term
 *                         that does not scale. Measured 2026-08-22: it moved
 *                         two shaping cards' column floors by two stored cells
 *                         between scale 0.75 and 1.5.
 *
 * The list is what stops a SECOND region being half-declared. The two members
 * below share one declaration block in app.css precisely so the four cannot
 * drift apart; this test is what notices if someone splits them.
 */
const FIXED_REGIONS = [".shp-scroll", ".shp-tools-region"];

for (const sel of FIXED_REGIONS) {
	test(`${sel} declares all four fixed-region rules`, () => {
		const body = declarationsFor(sel);
		assert.match(body, /flex:\s*0\s+0\s+auto/, `${sel} must not shrink with the card`);
		// EITHER bound, and exactly one of them: `.shp-scroll` holds a list of
		// unknown length, so its bound is a ceiling; `.shp-tools-region` holds a
		// disclosure that must not change size at all, so its bound is a height.
		// Two declarations of the same number would be two places to change it.
		const bounds = [...body.matchAll(/(?:^|[;{\s])((?:max-)?height):\s*([^;]+)/g)];
		assert.equal(bounds.length, 1,
			`${sel} must declare exactly one height bound, not ${bounds.length}`);
		assert.match(bounds[0]![2]!, /calc\(\s*[\d.]+\s*\*\s*var\(--u\)\s*\)/,
			`${sel}'s height must be declared in u, not derived and not in px`);
		assert.match(body, /overflow-y:\s*auto/, `${sel} must scroll internally`);
		assert.match(body, /scrollbar-width:\s*none/, `${sel}'s scrollbar would enter the card's min-content width`);
	});

	test(`${sel} hides its webkit scrollbar too`, () => {
		const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		assert.match(appCss, new RegExp(`${escaped}::-webkit-scrollbar\\s*(?:,[^{}]*)?\\{[^}]*display:\\s*none`),
			`scrollbar-width: none is Firefox-only; ${sel} needs the webkit rule as well`);
	});
}
