/**
 * File-type detection for the editor — pure, no CodeMirror imports, so it can
 * be used eagerly (to label a file, pick a mode) without pulling the heavy CM6
 * bundle. The actual language extensions live in setup.ts (lazy-loaded).
 */

export type EditorLang = "gcode" | "json" | "text";

const GCODE_EXTS = new Set(["g", "gcode", "gc", "gco", "nc"]);

/** Map a file path to an editor language by its extension. */
export function languageFor(path: string): EditorLang {
	const dot = path.lastIndexOf(".");
	const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
	if (ext === "json") return "json";
	if (GCODE_EXTS.has(ext)) return "gcode";
	return "text";
}
