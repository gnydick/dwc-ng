/**
 * #98: the blank row that used to sit between the Running line and the tool
 * picker in `ShapingStatusBody`, reserved for a message that is empty in the
 * ordinary session.
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

test("the message row is gated by a Show, not always mounted", () => {
	const source = cards();
	assert.match(
		source,
		/<Show when=\{message\(\) !== ""\}>\s*<p class="shp-msg">\{message\(\)\}<\/p>\s*<\/Show>/,
		"a message-less render must not put the .shp-msg <p> in the tree at all",
	);
});

test(".shp-msg reserves no height for the case where there is no message", () => {
	const block = /\.shp-msg\s*\{([^}]*)\}/.exec(css());
	assert.ok(block, ".shp-msg must still style the message when one is shown");
	assert.doesNotMatch(block![1]!, /min-height/, "a fixed min-height is exactly the reserved row #98 removes");
	assert.doesNotMatch(block![1]!, /visibility/, "visibility-hiding was the old always-mounted design; Show replaces it");
});
