/**
 * CodeMirror 6 wiring. This module is imported dynamically (see FileEditor) so
 * the whole CM6 bundle stays out of the initial load — it only ships when the
 * user actually opens a file. Everything CM6-specific lives here; the rest of
 * the app talks to the small EditorHandle surface below.
 */
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { StreamLanguage, HighlightStyle, syntaxHighlighting, type StreamParser } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
import { tags as t } from "@lezer/highlight";
import type { EditorLang } from "./lang.ts";

/**
 * Minimal G-code tokenizer for RRF. No off-the-shelf CM6 G-code mode exists, and
 * G-code is simple: line/paren comments, quoted strings, G/M/T command words,
 * single-letter parameters (X, E, S, P…) and numbers. Highlighting these four
 * classes is enough to make config.g and macros readable.
 */
const gcodeParser: StreamParser<unknown> = {
	name: "gcode",
	token(stream) {
		if (stream.eatSpace()) return null;
		if (stream.match(/;.*/) || stream.match(/\([^)]*\)/)) return "comment";
		if (stream.match(/"(?:[^"\\]|\\.)*"/)) return "string";
		if (stream.match(/[GMT]\d+(?:\.\d+)?/i)) return "keyword"; // command word
		if (stream.match(/[A-Za-z]/)) return "propertyName"; // parameter letter
		if (stream.match(/-?\d+(?:\.\d+)?/)) return "number";
		stream.next();
		return null;
	},
};

function languageExtension(lang: EditorLang): Extension {
	if (lang === "json") return json();
	if (lang === "gcode") return StreamLanguage.define(gcodeParser);
	return [];
}

/** Dark theme keyed to the app palette (CSS vars resolve at render time). */
const theme = EditorView.theme(
	{
		"&": { color: "var(--silk)", backgroundColor: "var(--mask-900)", fontSize: "calc(3.25 * var(--u))", height: "100%" },
		".cm-scroller": {
			fontFamily: 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
			lineHeight: "1.55",
		},
		"&.cm-focused": { outline: "none" },
		".cm-content": { caretColor: "var(--accent-bright)" },
		".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent-bright)" },
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
			backgroundColor: "rgba(217, 133, 59, 0.22)",
		},
		".cm-selectionMatch": { backgroundColor: "rgba(217, 133, 59, 0.14)" },
		".cm-gutters": {
			backgroundColor: "var(--mask-900)",
			color: "var(--silk-dim)",
			border: "none",
			boxShadow: "inset -1px 0 0 var(--hairline)",
		},
		".cm-activeLine": { backgroundColor: "rgba(255, 255, 255, 0.03)" },
		".cm-activeLineGutter": { backgroundColor: "rgba(255, 255, 255, 0.05)", color: "var(--silk)" },
		".cm-matchingBracket": { backgroundColor: "rgba(217, 133, 59, 0.25)", color: "inherit" },
	},
	{ dark: true },
);

/** Syntax colours for the standard token tags the G-code/JSON modes emit. */
const highlight = HighlightStyle.define([
	{ tag: t.comment, color: "var(--silk-dim)", fontStyle: "italic" },
	{ tag: t.number, color: "#7fb2ff" },
	{ tag: [t.keyword, t.operatorKeyword], color: "var(--accent-bright)", fontWeight: "600" },
	{ tag: [t.string, t.special(t.string)], color: "#6fbf8f" },
	{ tag: [t.propertyName], color: "#9ecbff" },
	{ tag: [t.bool, t.null], color: "var(--gold)" },
	{ tag: t.invalid, color: "var(--fault)" },
]);

export interface EditorHandle {
	/** Current document text. */
	getDoc(): string;
	/**
	 * Replace the whole document, KEEPING the current clean baseline — so the
	 * result still reads dirty if it differs from the board's copy. This is what
	 * stepping through the checkpoint history uses: arriving at an older
	 * revision is not the same as that revision having been saved.
	 */
	replaceDoc(text: string): void;
	/** Replace the whole document and treat the new text as the clean baseline. */
	setDoc(text: string): void;
	/** Tear down the CodeMirror instance. */
	destroy(): void;
}

export interface EditorOptions {
	doc: string;
	/**
	 * What "unsaved" is measured against. Defaults to `doc`, which is right when
	 * a file is opened straight off the board; a restored draft passes the
	 * board's copy here so it opens already showing as dirty.
	 */
	baseline?: string;
	lang: EditorLang;
	/** Called with the current dirty state whenever the document changes. */
	onDirty(dirty: boolean): void;
	readOnly?: boolean;
}

/** Mount a CodeMirror editor into `parent` and return a small control handle. */
export function createEditor(parent: HTMLElement, opts: EditorOptions): EditorHandle {
	let baseline = opts.baseline ?? opts.doc;
	const view = new EditorView({
		parent,
		state: EditorState.create({
			doc: opts.doc,
			extensions: [
				basicSetup,
				keymap.of([indentWithTab]),
				languageExtension(opts.lang),
				syntaxHighlighting(highlight),
				theme,
				EditorView.editable.of(opts.readOnly !== true),
				EditorState.readOnly.of(opts.readOnly === true),
				EditorView.updateListener.of(update => {
					if (update.docChanged) opts.onDirty(update.state.doc.toString() !== baseline);
				}),
			],
		}),
	});
	// The one write path. Dirtiness is DERIVED from the text and the baseline
	// every time rather than asserted per caller, so the two ways to replace the
	// document below cannot disagree about what "unsaved" means.
	const write = (text: string): void => {
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
		opts.onDirty(text !== baseline);
	};
	return {
		getDoc: () => view.state.doc.toString(),
		replaceDoc: write,
		setDoc(text) {
			baseline = text;
			write(text);
		},
		destroy: () => view.destroy(),
	};
}
