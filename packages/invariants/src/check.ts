/**
 * The one place a Declaration comes into existence. The brand is unforgeable
 * outside this module, so a consumer holding a Declaration knows every rule
 * below was applied to it — render() cannot be handed an unchecked one, and
 * that is a compile error rather than a thing to remember.
 *
 * Parse, don't validate: the unchecked shape stops existing at this boundary.
 */
import { namespaceOf } from "./paths.ts";
import type { RawDeclaration } from "./parse.ts";

/** Below this rung a declaration is debt and must carry its promotion. */
export const MIN_RUNG = 6;

export interface Problem {
	readonly file: string;
	readonly line: number;
	readonly message: string;
}

declare const valid: unique symbol;

export type Declaration = {
	readonly id: string;
	readonly namespace: string;
	readonly slug: string;
	readonly rung: number;
	readonly mechanism: string;
	readonly why: string;
	readonly debt: string | undefined;
	readonly file: string;
	readonly line: number;
} & { readonly [valid]: true };

const RUNG = /^([0-8])\b\s*(.*)$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function checkAll(raw: readonly RawDeclaration[]): {
	declarations: Declaration[];
	problems: Problem[];
} {
	const declarations: Declaration[] = [];
	const problems: Problem[] = [];
	const seen = new Map<string, RawDeclaration>();

	for (const item of raw) {
		const at = { file: item.file, line: item.line };
		const fail = (message: string): void => void problems.push({ ...at, message });

		let namespace: string;
		try {
			namespace = namespaceOf(item.file);
		} catch (err) {
			fail(err instanceof Error ? err.message : String(err));
			continue;
		}

		if (!SLUG.test(item.slug)) {
			fail(`"${item.slug}" is not a kebab-case slug`);
			continue;
		}

		const id = `${namespace}/${item.slug}`;
		const prior = seen.get(id);
		if (prior !== undefined) {
			fail(`duplicate invariant id "${id}" — already declared at ${prior.file}:${prior.line}`);
			continue;
		}

		if (item.rung === undefined) {
			fail(`"${id}" has no @rung`);
			continue;
		}
		const parsed = RUNG.exec(item.rung);
		if (parsed === null) {
			fail(`"${id}" has a @rung that is not a number 0-8`);
			continue;
		}
		const rung = Number(parsed[1]);
		const mechanism = parsed[2]!.trim();
		if (mechanism === "") {
			fail(`"${id}" states rung ${rung} with no named mechanism — the rung follows the mechanism, not the wording`);
			continue;
		}

		if (item.why === undefined || item.why.trim() === "") {
			fail(`"${id}" has no @why`);
			continue;
		}

		const debt = item.debt?.trim();
		if (rung < MIN_RUNG && (debt === undefined || debt === "")) {
			fail(`"${id}" sits at rung ${rung} with no @debt naming the promotion that would close it`);
			continue;
		}
		// Rung 6 is the accepted floor but not the target: a choke-point still
		// has a promotion to a sole-constructor type, and recording it is what
		// the rule means by "the weakest acceptable interim, and only with a row
		// naming the promotion". So @debt is REQUIRED below 6, OPTIONAL at 6,
		// and meaningless at 7-8 where there is nothing left to promote.
		if (rung > MIN_RUNG && debt !== undefined) {
			fail(`"${id}" is at rung ${rung} and carries @debt — above rung ${MIN_RUNG} there is nothing to promote`);
			continue;
		}

		seen.set(id, item);
		declarations.push({
			id,
			namespace,
			slug: item.slug,
			rung,
			mechanism,
			why: item.why.trim(),
			debt: debt === "" ? undefined : debt,
			file: item.file,
			line: item.line,
		} as Declaration);
	}

	return { declarations, problems };
}
