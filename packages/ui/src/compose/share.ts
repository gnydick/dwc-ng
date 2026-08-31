/**
 * Share files (phase B3): exporting and importing cards and screens as
 * data-only JSON files (I6 — the format has no field in which code could
 * travel; everything imported re-passes the same untrusted boundaries every
 * local card compiles through).
 *
 * The review contract: because the control vocabulary is CLOSED, walking a
 * spec enumerates EVERYTHING it can ever do — every G-code template, every
 * input, every OM read, every enumeration source. reviewSpec() extracts that
 * complete inventory; the import UI shows it before anything lands in the
 * config, so accepting a shared card means having seen every command it can
 * emit (the "controls wear their G-code" principle, applied at the border).
 *
 * Identity: minted ids never travel. An export carries names and specs; the
 * importer mints fresh "c-"/"u-" ids and remaps a screen's slot keys — a
 * foreign file cannot collide with (or overwrite) anything local by
 * construction.
 */
import { parseControlSpecText, type ParsedSpec } from "./controls/parse.ts";
import { omReadsOf } from "./controls/template.ts";
import { isInputRef, type CompiledControlSpec, type CompiledNode, type CompiledRowItem } from "./controls/spec.ts";
import { isCustomCardId } from "./composition.ts";
import { cardTitleOf, parseCardId } from "./defs.ts";
import { sanitizeCardMeta, type CustomCardMeta, type SlotRect, type UiConfig } from "../config/types.ts";
import type { ScreenEntry } from "./screens.ts";
import { isPlainObject, safeEntries } from "@dwc-ng/connector";
import { unreachable } from "../util/unreachable.ts";

export const SHARE_VERSION = 1;

// ---- review: the complete inventory of what a spec can do ----

export interface SpecReview {
	inputs: string[];
	/** Every button, with the RAW template (placeholders visible). */
	buttons: Array<{ label: string; template: string }>;
	/** Every slider — an emitter like a button, so its RAW template is here. */
	sliders: Array<{ input: string; template: string; min: number; max: number }>;
	/** Every toggle — an emitter with TWO alternatives: BOTH raw templates
	 *  are here, because accepting the card means having seen both, not just
	 *  whichever the current state resolves. */
	toggles: Array<{ om: string; whenOn: string; whenOff: string }>;
	/** Every select input's labeled options. A select never emits, but its
	 *  STRING values interpolate into templates verbatim, expanding what a
	 *  reviewed template can say beyond digits — so the reviewer sees every
	 *  author-enumerated value a placeholder can become. */
	selects: Array<{ input: string; options: Array<{ label: string; value: number | string }> }>;
	/** Every object-model read ({om:…} in templates, readout and toggle bindings). */
	omReads: string[];
	/** Every forEach enumeration source. */
	loops: string[];
	/** Motion primitives present (jog-pad/axis-jog — they emit via cmd.jog). */
	motion: string[];
}

export function reviewSpec(spec: CompiledControlSpec): SpecReview {
	const review: SpecReview = {
		inputs: Object.keys(spec.inputs),
		buttons: [],
		sliders: [],
		toggles: [],
		// Exhaustive over input kinds, not a filter: a future kind must SAY
		// what the review shows for it — numeric-only kinds contribute
		// nothing beyond digits, anything string-capable must be inventoried
		// — instead of silently classifying out of the review (the same
		// totality weld the node walk gets from `unreachable` below).
		selects: safeEntries(spec.inputs).flatMap(([input, def]): SpecReview["selects"] => {
			switch (def.kind) {
				case "number":
				case "chips":
					return [];
				case "select":
					return [{ input, options: def.options.map(opt => ({ label: opt.label, value: opt.value })) }];
			}
			return unreachable(def);
		}),
		omReads: [],
		loops: [],
		motion: [],
	};
	const seenOm = new Set<string>();
	const takeOm = (reads: string[]): void => {
		for (const read of reads) {
			if (!seenOm.has(read)) {
				seenOm.add(read);
				review.omReads.push(read);
			}
		}
	};
	const walkItem = (item: CompiledRowItem): void => {
		if (isInputRef(item)) return;
		walk(item);
	};
	const walk = (node: CompiledNode): void => {
		switch (node.type) {
			case "gcode-button":
				review.buttons.push({ label: node.label.text, template: node.template.text });
				takeOm(omReadsOf(node.label));
				takeOm(omReadsOf(node.template));
				return;
			case "jog-pad":
				review.motion.push("jog-pad (cmd.jog on X/Y/Z)");
				return;
			case "axis-jog":
				review.motion.push(`axis-jog (cmd.jog on {${node.axisVar}})`);
				return;
			case "readout":
				// A readout is a read and nothing else — its binding (and any
				// {om:…} in its label) joins the Reads inventory; no new category.
				takeOm([node.om.text]);
				if (node.label !== undefined) takeOm(omReadsOf(node.label));
				return;
			case "slider":
				review.sliders.push({ input: node.input, template: node.template.text, min: node.min, max: node.max });
				takeOm(omReadsOf(node.template));
				return;
			case "toggle":
				review.toggles.push({ om: node.om.text, whenOn: node.whenOn.text, whenOff: node.whenOff.text });
				takeOm([node.om.text]);
				if (node.label !== undefined) takeOm(omReadsOf(node.label));
				takeOm(omReadsOf(node.whenOn));
				takeOm(omReadsOf(node.whenOff));
				return;
			case "row":
				node.items.forEach(walkItem);
				return;
			case "grid":
				node.items.forEach(walk);
				return;
			case "forEach":
				review.loops.push(node.from.text);
				walk(node.node);
				return;
		}
		// Totality weld: the import review's completeness IS the safety
		// contract — a new CompiledNode variant that isn't inventoried above
		// must be a compile error here, never a silently-unreviewed control.
		unreachable(node);
	};
	spec.nodes.forEach(walk);
	return review;
}

// ---- export ----

function fileNameOf(name: string, kind: "card" | "screen"): string {
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || kind;
	return `${slug}.dwcng-${kind}.json`;
}

/** A stored card (name + spec text + chrome metadata) → share-file text.
 *  Null if the stored spec no longer parses (nothing broken should be
 *  exported). The metadata rides BESIDE the spec in the card object — never
 *  inside the spec JSON — and passes the ONE gate (sanitizeCardMeta) on the
 *  way out, so export and import agree field-for-field by construction: a
 *  field the gate does not know cannot travel, and a new CustomCardMeta
 *  field must be added to the gate to exist at all. */
export function exportCard(name: string, specText: string, meta: CustomCardMeta = {}): { fileName: string; text: string } | null {
	const parsed = parseControlSpecText(specText);
	if (!parsed.ok) return null;
	return {
		fileName: fileNameOf(name, "card"),
		text: JSON.stringify({ dwcng: "card", version: SHARE_VERSION, card: { name, spec: parsed.data, ...sanitizeCardMeta(meta) } }, null, 2),
	};
}

/**
 * A screen → share-file text. Embeds the definitions of every custom card
 * its composition references — a screen file is self-contained; registry
 * cards travel as their stable ids.
 *
 * A custom card whose stored spec no longer parses is dropped — slot and
 * definition both — matching exportCard's refuse-broken rule (audit L1):
 * embedding the raw broken text produced a file that could NEVER import.
 * The exported screen degrades by exactly that card, the same way the
 * live screen already does (its card shows an error body).
 */
export function exportScreen(entry: ScreenEntry, config: UiConfig): { fileName: string; text: string } {
	const cards: Record<string, SlotRect> = {};
	const customCards: Record<string, { name: string; spec: unknown } & CustomCardMeta> = {};
	for (const [id, slot] of safeEntries(entry.def.composition)) {
		if (slot === undefined) continue;
		if (isCustomCardId(id)) {
			const def = config.cards[id];
			if (def === undefined) continue;
			const parsed = parseControlSpecText(def.spec);
			if (!parsed.ok) continue;
			// Chrome metadata travels beside the spec, through the one gate —
			// see exportCard.
			customCards[id] = { name: def.name, spec: parsed.data, ...sanitizeCardMeta(def) };
		}
		cards[id] = {
			col: slot.col, row: slot.row, colSpan: slot.colSpan, rowSpan: slot.rowSpan,
			// Orientation is part of the slot: a shared screen that arrived with
			// every card's direction reset is not the screen that was shared.
			...(slot.orientation === undefined ? {} : { orientation: slot.orientation }),
		};
	}
	return {
		fileName: fileNameOf(entry.def.name, "screen"),
		text: JSON.stringify({
			dwcng: "screen",
			version: SHARE_VERSION,
			screen: { name: entry.def.name, cards },
			customCards,
		}, null, 2),
	};
}

// ---- import: parse + review, then commit via the config store ----

export interface CardImport {
	kind: "card";
	name: string;
	/** Normalized spec text, ready for addCustomCard. */
	specText: string;
	/** Chrome metadata (authored size, tip, padding) — already through the
	 *  one gate, ready to pass to addCustomCard's meta argument. */
	meta: CustomCardMeta;
	review: SpecReview;
}

/**
 * The review's rendering of chrome metadata, one line per present field —
 * total over CustomCardMeta by construction: the describer record is keyed
 * `Required<CustomCardMeta>`, so a new metadata field refuses to compile
 * until it says how the import review shows it (the same weld reviewSpec's
 * `unreachable` gives the control vocabulary — a field cannot be silently
 * unreviewed).
 */
export function describeCardMeta(meta: CustomCardMeta): string[] {
	const describers: { [K in keyof Required<CustomCardMeta>]: (v: NonNullable<CustomCardMeta[K]>) => string } = {
		colSpan: v => `default width ${v} cells`,
		rowSpan: v => `default height ${v} cells`,
		tip: v => `tip "${v}"`,
		padding: v => `body padding ${v}u`,
	};
	const lines: string[] = [];
	for (const key of Object.keys(describers) as Array<keyof Required<CustomCardMeta>>) {
		const value = meta[key];
		if (value !== undefined) lines.push(describers[key](value as never));
	}
	return lines;
}

export interface ScreenImport {
	kind: "screen";
	name: string;
	/** Slot key → rect, keys still the FILE's ids (remapped at commit). */
	cards: Record<string, SlotRect>;
	/** File id → definition + its complete review. */
	customCards: Array<{ fileId: string; name: string; specText: string; meta: CustomCardMeta; review: SpecReview }>;
	/** Registry cards the screen uses (stable ids, shown by title). */
	registryCards: string[];
	/** Slot keys that reference nothing known — dropped at commit. */
	dangling: string[];
}

export type ShareImport = CardImport | ScreenImport | { kind: "error"; error: string };

function asSlotRect(value: unknown): SlotRect | null {
	if (typeof value !== "object" || value === null) return null;
	const v = value as Record<string, unknown>;
	if ([v.col, v.row, v.colSpan, v.rowSpan].some(n => typeof n !== "number")) return null;
	return { col: v.col as number, row: v.row as number, colSpan: v.colSpan as number, rowSpan: v.rowSpan as number };
}

/** Parse a spec value (object or text) through the ONE boundary. */
function specOf(raw: unknown): { specText: string; parsed: ParsedSpec } {
	const specText = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
	return { specText, parsed: parseControlSpecText(specText) };
}

/** Share-file text → a reviewed import, or a named error. Never throws. */
export function parseShareFile(text: string): ShareImport {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (err) {
		return { kind: "error", error: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
	}
	if (typeof json !== "object" || json === null) return { kind: "error", error: "Not a dwc-ng share file." };
	const root = json as Record<string, unknown>;

	if (root.dwcng === "card") {
		const card = root.card;
		if (!isPlainObject(card) || typeof card.name !== "string") return { kind: "error", error: "Malformed card file." };
		const { specText, parsed } = specOf(card.spec);
		if (!parsed.ok) return { kind: "error", error: `The card's spec is invalid: ${parsed.error}` };
		// Metadata rides beside the spec; the gate keeps what passes and drops
		// each bad field by itself (the house per-leaf tolerance).
		return { kind: "card", name: card.name, specText, meta: sanitizeCardMeta(card), review: reviewSpec(parsed.spec) };
	}

	if (root.dwcng === "screen") {
		const screen = root.screen;
		if (!isPlainObject(screen) || typeof screen.name !== "string" || !isPlainObject(screen.cards)) {
			return { kind: "error", error: "Malformed screen file." };
		}
		const rawCustom = root.customCards ?? {};
		if (!isPlainObject(rawCustom)) return { kind: "error", error: "Malformed screen file." };
		const customCards: ScreenImport["customCards"] = [];
		for (const [fileId, entry] of safeEntries(rawCustom)) {
			if (!isPlainObject(entry) || typeof entry.name !== "string") {
				return { kind: "error", error: `Malformed embedded card "${fileId}".` };
			}
			const { specText, parsed } = specOf(entry.spec);
			if (!parsed.ok) return { kind: "error", error: `Embedded card "${entry.name}" is invalid: ${parsed.error}` };
			customCards.push({ fileId, name: entry.name, specText, meta: sanitizeCardMeta(entry), review: reviewSpec(parsed.spec) });
		}
		const cards: Record<string, SlotRect> = {};
		const registryCards: string[] = [];
		const dangling: string[] = [];
		const embedded = new Set(Object.keys(rawCustom));
		for (const [key, rect] of safeEntries(screen.cards)) {
			const slot = asSlotRect(rect);
			if (slot === null) continue;
			if (parseCardId(key) !== null) {
				cards[key] = slot;
				registryCards.push(cardTitleOf(parseCardId(key)!));
			} else if (isCustomCardId(key) && embedded.has(key)) {
				cards[key] = slot;
			} else {
				dangling.push(key);
			}
		}
		return { kind: "screen", name: screen.name, cards, customCards, registryCards, dangling };
	}

	return { kind: "error", error: "Not a dwc-ng share file (missing dwcng: \"card\" | \"screen\")." };
}

/** Rewrite a screen's slot keys through the file-id → minted-id map. */
export function remapScreenCards(cards: Record<string, SlotRect>, idMap: ReadonlyMap<string, string>): Record<string, SlotRect> {
	const out: Record<string, SlotRect> = {};
	for (const [key, rect] of safeEntries(cards)) {
		if (isCustomCardId(key)) {
			const minted = idMap.get(key);
			if (minted !== undefined) out[minted] = rect;
			// unmapped custom keys are dropped — nothing dangles
		} else {
			out[key] = rect;
		}
	}
	return out;
}
