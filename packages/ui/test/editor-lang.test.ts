import { test } from "node:test";
import assert from "node:assert/strict";
import { languageFor } from "../src/editor/lang.ts";

test("languageFor maps G-code extensions", () => {
	for (const p of ["0:/sys/config.g", "0:/macros/home.gcode", "part.gc", "prog.nc"]) {
		assert.equal(languageFor(p), "gcode", p);
	}
});

test("languageFor maps JSON config files", () => {
	assert.equal(languageFor("0:/sys/dwc-ng-config.json"), "json");
});

test("languageFor falls back to plain text", () => {
	assert.equal(languageFor("0:/sys/readme.txt"), "text");
	assert.equal(languageFor("0:/sys/noext"), "text");
});

test("languageFor is case-insensitive on the extension", () => {
	assert.equal(languageFor("HOME.G"), "gcode");
	assert.equal(languageFor("Config.JSON"), "json");
});
