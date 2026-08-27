/**
 * #98: the blank row that used to sit between the Running line and the tool
 * picker in `ShapingStatusBody`, reserved for a message that is empty in the
 * ordinary session.
 *
 * Round 2 (review + Gabe): the first fix left the message between the
 * Running line and the picker, which moves the picker/table/steps down by
 * the message's own height whenever the card has no slack above its content
 * floor to hide the move in — which, at the card's registered rowSpan, is
 * every session. The message now renders LAST, after the step list, so
 * there is nothing below it left to move. What this file pins changed with
 * it: not just "no reserved row", but "the message is the last thing this
 * card renders, so its arrival moves nothing else."
 *
 * `ShapingCards.tsx` is JSX and `.tsx` cannot be type-stripped by node:test
 * (see `test/machine-card.test.ts`'s own note on the same limit), so this
 * pins the change the same way `shaping-motion-fence.test.ts` pins its own
 * cards-file rules: by reading the source text rather than mounting the
 * component. `statusMessageText` itself — the message a message row shows —
 * is a plain function and is tested directly in `shaping-copy.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cards = () => readFileSync(new URL("../src/cards/ShapingCards.tsx", import.meta.url), "utf8");
const css = () => readFileSync(new URL("../src/app.css", import.meta.url), "utf8");

/** The exact source text of `ShapingStatusBody`, from its own `export
 *  function` line up to the next one — so a positional assertion below
 *  cannot accidentally match a `.shp-msg`-shaped string in a different
 *  card body. */
function statusBodySource(): string {
	const source = cards();
	const start = source.indexOf("export function ShapingStatusBody");
	assert.notEqual(start, -1, "ShapingStatusBody must still exist under this name");
	const next = source.indexOf("export function", start + 1);
	assert.notEqual(next, -1, "a card body must follow ShapingStatusBody in this file");
	return source.slice(start, next);
}

test("the message row is gated by a Show, not always mounted", () => {
	assert.match(
		statusBodySource(),
		/<Show when=\{message\(\) !== ""\}>\s*<p class="shp-msg">\{message\(\)\}<\/p>\s*<\/Show>/,
		"a message-less render must not put the .shp-msg <p> in the tree at all",
	);
});

test("the message renders after the step list, not before the picker or the table", () => {
	const body = statusBodySource();
	const stepsClose = body.indexOf("</ol>");
	const msgShow = body.indexOf('<Show when={message() !== ""}>');
	assert.notEqual(stepsClose, -1, "the step list must still be an <ol>");
	assert.notEqual(msgShow, -1, "the message's Show block must still exist");
	assert.ok(msgShow > stepsClose, "the message must render after the step list closes, or its arrival moves the list");
});

test("nothing renders after the message — its own arrival has nothing below it to move", () => {
	const body = statusBodySource();
	const msgShowClose = body.indexOf("</Show>", body.indexOf('<Show when={message() !== ""}>'));
	assert.notEqual(msgShowClose, -1);
	// Only the fragment close, the JSX return's closing paren, and the
	// function's closing brace may follow — anything else here is a second
	// element rendered after the message, which is the regression this test
	// exists to catch. `body` legitimately runs on past the function's own
	// `}` (comments and declarations before the next `export function`), so
	// this checks the START of what follows, not the whole remainder.
	const tail = body.slice(msgShowClose + "</Show>".length).trimStart();
	assert.match(
		tail,
		/^<\/>\s*\);\s*}/,
		`the message must be the last child ShapingStatusBody renders; found immediately after it: ${tail.slice(0, 120)}`,
	);
});

test(".shp-msg reserves no height for the case where there is no message", () => {
	const block = /\.shp-msg\s*\{([^}]*)\}/.exec(css());
	assert.ok(block, ".shp-msg must still style the message when one is shown");
	assert.doesNotMatch(block![1]!, /min-height/, "a fixed min-height is exactly the reserved row #98 removes");
	assert.doesNotMatch(block![1]!, /visibility/, "visibility-hiding was the old always-mounted design; Show replaces it");
});

test(".shp-msg stays flex:0 0 auto, so it cannot stretch or shrink to absorb the panel body's free space", () => {
	assert.match(
		css(),
		/\.shp-active,\s*\.shp-msg,[^{]*\{\s*flex:\s*0\s*0\s*auto;/,
		".shp-msg must stay in the fixed-size list beside the card's other flex:0 0 auto blocks",
	);
});
