/**
 * G-code templates for data-defined controls.
 *
 * @invariant template-compiles-whole
 * @rung 7  sole-constructor type — compileTemplate is the only producer of the
 *          branded CompiledTemplate and returns null on the first unresolvable
 *          name, so a partially-valid template cannot survive into a renderable
 *          control. Was design I13
 * @why a placeholder that silently rendered as its own source text would send
 *      literal "{input.step}" to the board as G-code. Compiling whole-or-not-at
 *      -all means the failure is at authoring time, not at the machine
 *
 * A template is literal text with `{...}` placeholders. Placeholder forms:
 *
 *   {input.step}          a card input's live value
 *   {om:heat.heaters[0].active}   an OM read (selector grammar, I14)
 *   {axis.letter}         a forEach loop variable's property
 *
 * Resolution is total: a missing value renders as "" — the control's stamp
 * (I15) makes an unresolved placeholder VISIBLE as a gap in the shown code
 * rather than hiding it behind an error.
 */
import { parseOmSelector, readOm, type OmSelector } from "./omSelector.ts";

type Token =
	| { kind: "text"; text: string }
	| { kind: "input"; name: string }
	| { kind: "om"; selector: OmSelector }
	| { kind: "var"; name: string; prop: string };

declare const brand: unique symbol;
export type CompiledTemplate = { readonly tokens: readonly Token[]; readonly text: string } & { readonly [brand]: true };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The boundary: a template string compiles here or does not exist. */
export function compileTemplate(raw: string): CompiledTemplate | null {
	const tokens: Token[] = [];
	let rest = raw;
	while (rest.length > 0) {
		const open = rest.indexOf("{");
		if (open < 0) {
			tokens.push({ kind: "text", text: rest });
			break;
		}
		if (open > 0) tokens.push({ kind: "text", text: rest.slice(0, open) });
		const close = rest.indexOf("}", open);
		if (close < 0) return null; // unterminated placeholder
		const body = rest.slice(open + 1, close);
		rest = rest.slice(close + 1);

		if (body.startsWith("om:")) {
			const selector = parseOmSelector(body.slice(3));
			if (selector === null) return null;
			tokens.push({ kind: "om", selector });
		} else if (body.startsWith("input.")) {
			const name = body.slice(6);
			if (!IDENT.test(name)) return null;
			tokens.push({ kind: "input", name });
		} else {
			const dot = body.indexOf(".");
			if (dot < 0) return null;
			const name = body.slice(0, dot);
			const prop = body.slice(dot + 1);
			if (!IDENT.test(name) || !IDENT.test(prop)) return null;
			tokens.push({ kind: "var", name, prop });
		}
	}
	return { tokens, text: raw } as unknown as CompiledTemplate;
}

export interface TemplateScope {
	/** Card input name → live value. */
	input: (name: string) => string | number | undefined;
	/** The object model root for {om:…} reads. */
	om: unknown;
	/** forEach loop variables: as-name → current item. */
	vars: Record<string, unknown>;
}

function show(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "number") return String(value);
	return String(value);
}

/** The OM selectors a template reads — for the import review's inventory. */
export function omReadsOf(template: CompiledTemplate): string[] {
	const reads: string[] = [];
	for (const token of template.tokens) {
		if (token.kind === "om") reads.push(token.selector.text);
	}
	return reads;
}

/** Total resolution — every input has a defined (possibly "") rendering. */
export function resolveTemplate(template: CompiledTemplate, scope: TemplateScope): string {
	let out = "";
	for (const token of template.tokens) {
		switch (token.kind) {
			case "text":
				out += token.text;
				break;
			case "input":
				out += show(scope.input(token.name));
				break;
			case "om":
				out += show(readOm(scope.om, token.selector));
				break;
			case "var": {
				const item = scope.vars[token.name];
				out += show(typeof item === "object" && item !== null ? (item as Record<string, unknown>)[token.prop] : undefined);
				break;
			}
		}
	}
	return out;
}
