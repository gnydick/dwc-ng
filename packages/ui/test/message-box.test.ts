import { test } from "node:test";
import assert from "node:assert/strict";
import {
	MessageBoxMode, ackCommand, axisControlIndices, initialInput, isBlocking, needsInput,
} from "../src/messagebox/ack.ts";
import type { MessageBox } from "../src/om/types.ts";

/** A message box with everything defaulted; override only what a test cares about. */
function box(patch: Partial<MessageBox> = {}): MessageBox {
	return {
		mode: MessageBoxMode.okOnly,
		seq: 7,
		title: "",
		message: "",
		axisControls: null,
		cancelButton: false,
		choices: null,
		default: null,
		min: null,
		max: null,
		timeout: 0,
		...patch,
	};
}

// The seq MUST be echoed back. RRF ignores an M292 whose seq doesn't match the
// box it currently has open, which is what stops a click landing on a box that
// was replaced between render and press — a real hazard in tool-change macros
// that raise several boxes in a row.
test("plain acknowledge echoes the seq", () => {
	assert.equal(ackCommand(box({ mode: MessageBoxMode.okOnly }), null), "M292 S7");
	assert.equal(ackCommand(box({ mode: MessageBoxMode.closeOnly }), null), "M292 S7");
	assert.equal(ackCommand(box({ mode: MessageBoxMode.okCancel }), null), "M292 S7");
});

test("seq 0 is echoed, not treated as absent", () => {
	assert.equal(ackCommand(box({ seq: 0 }), null), "M292 S0");
});

test("cancel sends P1 and still echoes the seq", () => {
	assert.equal(
		ackCommand(box({ mode: MessageBoxMode.okCancel, cancelButton: true }), { cancelled: true }),
		"M292 P1 S7",
	);
});

test("a box with no buttons has nothing to acknowledge", () => {
	assert.equal(ackCommand(box({ mode: MessageBoxMode.noButtons }), null), null);
});

test("numeric input is wrapped in an RRF expression literal", () => {
	assert.equal(ackCommand(box({ mode: MessageBoxMode.intInput }), { value: 5 }), "M292 R{5} S7");
	assert.equal(ackCommand(box({ mode: MessageBoxMode.floatInput }), { value: 1.25 }), "M292 R{1.25} S7");
	assert.equal(ackCommand(box({ mode: MessageBoxMode.floatInput }), { value: -0.5 }), "M292 R{-0.5} S7");
});

test("string input is quoted", () => {
	assert.equal(ackCommand(box({ mode: MessageBoxMode.stringInput }), { value: "PLA" }), 'M292 R{"PLA"} S7');
});

// RRF doubles a quote to escape it inside a string literal. Without this an
// operator typing a quote into a filament name produces a malformed expression
// and the firmware stays blocked.
test("string input escapes quotes so the expression stays well-formed", () => {
	assert.equal(
		ackCommand(box({ mode: MessageBoxMode.stringInput }), { value: 'a"b' }),
		'M292 R{"a""b"} S7',
	);
	assert.equal(
		ackCommand(box({ mode: MessageBoxMode.stringInput }), { value: "a'b" }),
		"M292 R{\"a''b\"} S7",
	);
});

test("multiple choice sends the chosen index", () => {
	const b = box({ mode: MessageBoxMode.multipleChoice, choices: ["Left", "Right", "Neither"] });
	assert.equal(ackCommand(b, { value: 0 }), "M292 R{0} S7");
	assert.equal(ackCommand(b, { value: 2 }), "M292 R{2} S7");
});

test("cancel wins over a pending input value", () => {
	const b = box({ mode: MessageBoxMode.stringInput, cancelButton: true });
	assert.equal(ackCommand(b, { cancelled: true, value: "ignored" }), "M292 P1 S7");
});

// mode >= okOnly means the firmware is WAITING. Those must be unskippable;
// modes 0 and 1 are informational and may be dismissed locally.
test("blocking is exactly modes okOnly and above", () => {
	assert.equal(isBlocking(box({ mode: MessageBoxMode.noButtons })), false);
	assert.equal(isBlocking(box({ mode: MessageBoxMode.closeOnly })), false);
	assert.equal(isBlocking(box({ mode: MessageBoxMode.okOnly })), true);
	assert.equal(isBlocking(box({ mode: MessageBoxMode.okCancel })), true);
	assert.equal(isBlocking(box({ mode: MessageBoxMode.multipleChoice })), true);
	assert.equal(isBlocking(box({ mode: MessageBoxMode.stringInput })), true);
});

test("only the input modes need an input", () => {
	assert.equal(needsInput(box({ mode: MessageBoxMode.okOnly })), false);
	assert.equal(needsInput(box({ mode: MessageBoxMode.multipleChoice })), false);
	assert.equal(needsInput(box({ mode: MessageBoxMode.intInput })), true);
	assert.equal(needsInput(box({ mode: MessageBoxMode.floatInput })), true);
	assert.equal(needsInput(box({ mode: MessageBoxMode.stringInput })), true);
});

// `default` seeds the field so the common case is one click.
test("initialInput seeds from default, by input kind", () => {
	assert.equal(initialInput(box({ mode: MessageBoxMode.intInput, default: 42 })), 42);
	assert.equal(initialInput(box({ mode: MessageBoxMode.floatInput, default: 1.5 })), 1.5);
	assert.equal(initialInput(box({ mode: MessageBoxMode.stringInput, default: "PETG" })), "PETG");
	// wrong-typed or absent default must not leak into the other input kind
	assert.equal(initialInput(box({ mode: MessageBoxMode.intInput, default: "nope" })), 0);
	assert.equal(initialInput(box({ mode: MessageBoxMode.stringInput, default: 7 })), "");
	assert.equal(initialInput(box({ mode: MessageBoxMode.intInput, default: null })), 0);
});

// axisControls is a BITMAP OVER move.axes INDEX, not over axis letters — an
// off-by-one here jogs the wrong axis during a filament change.
test("axisControls selects axes by index bit", () => {
	assert.deepEqual(axisControlIndices(box({ axisControls: null })), []);
	assert.deepEqual(axisControlIndices(box({ axisControls: 0 })), []);
	assert.deepEqual(axisControlIndices(box({ axisControls: 0b001 })), [0]);
	assert.deepEqual(axisControlIndices(box({ axisControls: 0b100 })), [2]);
	assert.deepEqual(axisControlIndices(box({ axisControls: 0b1011 })), [0, 1, 3]);
});
