/**
 * Installing a shaper: the two acts, and the words that keep them apart.
 *
 * The distinction is the whole point. `send` lasts until the firmware resets
 * or the next toolchange runs `tpost<N>.g` over the top of it; `macro` changes
 * what the machine does at every future pickup of that head. An operator who
 * meant one and got the other has either lost their setting silently or
 * changed their machine permanently by accident, and the screen afterwards
 * looks the same either way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyHowText, applyStateText, armedApplyText } from "../src/shaping/copy.ts";
import type { ApplyHow, ApplyIntent, ApplyState } from "../src/shaping/applyRun.ts";
import type { ShaperSpec } from "../src/shaping/engine/shapers.ts";
import { cmd } from "../src/control/commands.ts";
import { hz } from "../src/shaping/engine/units.ts";

const SPEC: ShaperSpec = { type: "ei2", F: hz(51.5), S: 0.05 };

test("every apply state has a sentence and leaks no placeholder", () => {
	const EVERY: readonly ApplyState[] = [
		{ kind: "idle" },
		{ kind: "working", how: "send" },
		{ kind: "working", how: "macro" },
		{ kind: "done", how: "send", line: cmd.inputShaping(SPEC) },
		{ kind: "done", how: "macro", line: cmd.inputShaping(SPEC) },
		{ kind: "failed", why: "upload refused" },
	];
	for (const s of EVERY) {
		const text = applyStateText(s);
		assert.ok(!/\bundefined\b|\[object/.test(text), `${s.kind} leaked: ${text}`);
		// Idle is the one that says nothing; the slot holds the em dash there.
		if (s.kind !== "idle") assert.ok(text.length > 0, `${s.kind} has no copy`);
	}
});

test("the two acts never describe themselves the same way", () => {
	const send = applyHowText("send");
	const macro = applyHowText("macro");
	assert.notEqual(send, macro);
	// Each must say what SURVIVES, since that is the thing the operator has to
	// predict — "temporary" would not convey that tpost runs at every pickup.
	assert.match(send, /reset|toolchange/i);
	assert.match(macro, /every pickup|post-select|macro/i);
});

test("a finished apply says which act it was, not merely that it worked", () => {
	const line = cmd.inputShaping(SPEC);
	const sent = applyStateText({ kind: "done", how: "send", line });
	const written = applyStateText({ kind: "done", how: "macro", line });
	assert.notEqual(sent, written, "'applied' is not an answer to 'will it survive a toolchange'");
	for (const t of [sent, written]) assert.ok(t.includes(line), "the line itself must be in the sentence");
});

test("the armed confirm names the line, the destination and the consequence", () => {
	const line = cmd.inputShaping(SPEC);

	const send: ApplyIntent = { how: "send", tool: 0, spec: SPEC };
	const sendText = armedApplyText(send);
	assert.ok(sendText.includes(line));
	assert.match(sendText, /Escape cancels/);
	assert.match(sendText, /reset|toolchange/i);

	const macro: ApplyIntent = { how: "macro", tool: 3, spec: SPEC };
	const macroText = armedApplyText(macro);
	assert.ok(macroText.includes(line));
	// The PATH, because writing to the wrong tool's macro is the mistake a
	// toolchanger makes easily and cannot see afterwards.
	assert.match(macroText, /0:\/sys\/tpost3\.g/);
	assert.match(macroText, /T3/);
});

test("the confirm for one act cannot be mistaken for the other", () => {
	const a = armedApplyText({ how: "send", tool: 0, spec: SPEC });
	const b = armedApplyText({ how: "macro", tool: 0, spec: SPEC });
	assert.notEqual(a, b);
	assert.match(a, /send/i);
	assert.match(b, /write/i);
});

test("the line in the confirm is the one commands.ts builds, not a second spelling", () => {
	// A confirm that showed a line the sender does not send is consent given
	// against the wrong thing.
	for (const how of ["send", "macro"] as ApplyHow[]) {
		assert.ok(armedApplyText({ how, tool: 0, spec: SPEC }).includes(cmd.inputShaping(SPEC)));
	}
});
