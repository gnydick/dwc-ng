# Invariant Coverage — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **REQUIRED READING before any task:** read the skill file
> `C:\Users\Gabe E. Nydick\.claude\plugins\cache\ai-skills\unbreakable\0.2.2\skills\cant-break-by-design\SKILL.md`
> in full. Not a paraphrase of it. Every task here is judged against its ladder,
> and Tasks 9+ require you to assign rungs using its rule 9 — *from the
> mechanism, never from the wording*.

**Goal:** Build a generator that extracts invariant declarations from source, emits `docs/invariant-register.md`, and fails the test suite when the register drifts or the debt count rises — then sweep all 247 source files declaring every invariant at its true current rung.

**Architecture:** A zero-dependency workspace package `packages/invariants` parses `@invariant` comment blocks out of `.ts`/`.tsx`/`.css`, validates them into a branded `Declaration` type that only the validator can produce, renders a deterministic markdown register, and pins both the register and a monotonic debt ceiling with `node:test` cases that ride the existing `pnpm test`.

**Tech Stack:** TypeScript ~6.0.2 (type-stripped by Node 26, never compiled), `node:test`, `node:fs`. No runtime dependencies — none may be added.

## Global Constraints

- **Zero new dependencies.** CLAUDE.md forbids adding any without asking Gabe first. This package uses only Node built-ins. `devDependencies` are exactly `@types/node ^24.13.2` and `typescript ~6.0.2`, matching `packages/mock-duet` and `packages/deploy`.
- **Indentation is TABS** throughout this repo. Match it.
- **Imports carry the `.ts` extension** (`import { x } from "./parse.ts"`) — `allowImportingTsExtensions` is on.
- **`erasableSyntaxOnly`** — no `enum`, no parameter properties, no `namespace`. Use `const` objects and union types.
- **`verbatimModuleSyntax`** — type-only imports must be `import type { ... }`.
- **`strict` + `noUncheckedIndexedAccess`** — indexing an array yields `T | undefined`; handle it, never `!`-assert to silence it except where an adjacent length check proves it.
- **Never edit `docs/invariant-register.md` by hand.** It is generated output.
- **Reference source is read-only.** Nothing under `reference/` is scanned, copied, or paraphrased.
- Commit messages end with the two trailers used across this repo:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01U8FC79trVbPLvyfjbbsEd4`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/invariants/package.json` | Package manifest; `test`, `typecheck`, `generate`, `check` scripts |
| `packages/invariants/tsconfig.json` | Copy of the mock-duet compiler settings |
| `packages/invariants/debt-ceiling.json` | The single committed integer the ratchet compares against |
| `packages/invariants/src/paths.ts` | Repo-relative path → namespace derivation |
| `packages/invariants/src/parse.ts` | Comment block text → `RawDeclaration[]` (no judgement, no validation) |
| `packages/invariants/src/check.ts` | `RawDeclaration[]` → `Declaration[]` or `Problem[]`; **sole producer of `Declaration`** |
| `packages/invariants/src/scan.ts` | Walk `packages/*/`, read files, collect raw declarations |
| `packages/invariants/src/render.ts` | `Declaration[]` → the register's markdown bytes |
| `packages/invariants/src/cli.ts` | `generate` \| `check` entry points |
| `packages/invariants/test/*.test.ts` | Unit tests, plus the drift and ratchet gates |
| `docs/invariant-register.md` | **Generated.** Replaces `docs/invariant-ledger.md`, which is deleted in Task 8 |

The parse/check split is deliberate and is the tool's own invariant: `render` accepts only `Declaration`, whose brand is unforgeable outside `check.ts`, so an unvalidated declaration cannot reach the register. The tool obeys the standard it enforces.

---

## Task 1: Package scaffold and namespace derivation

**Files:**
- Create: `packages/invariants/package.json`
- Create: `packages/invariants/tsconfig.json`
- Create: `packages/invariants/src/paths.ts`
- Test: `packages/invariants/test/paths.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `namespaceOf(repoRelPath: string): string` — throws `Error` when the path is not under `packages/<pkg>/`.

- [ ] **Step 1: Create the package manifest**

`packages/invariants/package.json`:

```json
{
  "name": "@dwc-ng/invariants",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "description": "Extracts @invariant declarations from source into docs/invariant-register.md, and gates drift and debt (spec: docs/superpowers/specs/2026-07-31-invariant-coverage-design.md).",
  "scripts": {
    "generate": "node src/cli.ts generate",
    "check": "node src/cli.ts check",
    "test": "node --test",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^24.13.2",
    "typescript": "~6.0.2"
  }
}
```

- [ ] **Step 2: Create the tsconfig**

`packages/invariants/tsconfig.json` — identical settings to `packages/mock-duet/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Install so pnpm links the new package**

Run from the repo root: `pnpm install`

Expected: pnpm reports the new workspace project `@dwc-ng/invariants`. The `packages/*` glob in `pnpm-workspace.yaml` picks it up with no edit to that file.

- [ ] **Step 4: Write the failing test**

`packages/invariants/test/paths.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { namespaceOf } from "../src/paths.ts";

test("a nested source directory becomes a slash-joined namespace", () => {
	assert.equal(namespaceOf("packages/ui/src/compose/controls/spec.ts"), "compose/controls");
});

test("one level under src is that one directory", () => {
	assert.equal(namespaceOf("packages/ui/src/files/path.ts"), "files");
});

test("a file directly in src falls back to the package name", () => {
	assert.equal(namespaceOf("packages/ui/src/app.css"), "ui");
	assert.equal(namespaceOf("packages/deploy/src/manifest.ts"), "deploy");
});

test("a file outside packages/ is rejected rather than guessed at", () => {
	assert.throws(() => namespaceOf("docs/notes.md"), /not under packages/);
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run from `packages/invariants`: `node --test test/paths.test.ts`

Expected: FAIL — `Cannot find module '../src/paths.ts'`.

- [ ] **Step 6: Write the implementation**

`packages/invariants/src/paths.ts`:

```ts
/**
 * A declaration's namespace is DERIVED from where it lives, never written by
 * the author — so a namespace that disagrees with the file's location has no
 * encoding. Moving a file renames its ids, which shows up as a visible diff in
 * the generated register rather than a silent mismatch.
 *
 * Rule: strip `packages/<pkg>/`, strip a leading `src/`, then join the
 * remaining directory segments. Nothing left means the package name itself.
 */
export function namespaceOf(repoRelPath: string): string {
	const parts = repoRelPath.split("/");
	if (parts[0] !== "packages" || parts.length < 3) {
		throw new Error(`${repoRelPath} is not under packages/<pkg>/`);
	}
	const pkg = parts[1]!; // length >= 3 proves index 1 exists
	let rest = parts.slice(2);
	if (rest[0] === "src") rest = rest.slice(1);
	const dir = rest.slice(0, -1); // drop the filename
	return dir.length === 0 ? pkg : dir.join("/");
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run from `packages/invariants`: `node --test test/paths.test.ts`

Expected: PASS, 4/4.

- [ ] **Step 8: Commit**

```bash
git add packages/invariants pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(invariants): the package, and a namespace nobody has to type

Deriving the namespace from the file's location means a namespace that
disagrees with where the declaration lives cannot be written at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U8FC79trVbPLvyfjbbsEd4
EOF
)"
```

---

## Task 2: Parse comment blocks into raw declarations

**Files:**
- Create: `packages/invariants/src/parse.ts`
- Test: `packages/invariants/test/parse.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  ```ts
  export interface RawDeclaration {
      readonly slug: string;
      readonly rung: string | undefined;   // raw text after "@rung"
      readonly why: string | undefined;
      readonly debt: string | undefined;
      readonly file: string;               // repo-relative, forward slashes
      readonly line: number;               // 1-based line of the @invariant tag
  }
  export function parseDeclarations(text: string, file: string): RawDeclaration[];
  ```
  `parse.ts` makes **no judgements** — missing fields come back `undefined` for `check.ts` to rule on. This keeps every validation rule in exactly one place.

- [ ] **Step 1: Write the failing test**

`packages/invariants/test/parse.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeclarations } from "../src/parse.ts";

test("a complete block yields every field, with the tag's line number", () => {
	const text = [
		"const a = 1;",
		"/**",
		" * @invariant path-escape",
		" * @rung 7  sole-constructor type — parseFileName is the only producer",
		" * @why     a typed name can never reach outside its directory",
		" */",
		"export const x = 2;",
	].join("\n");
	const found = parseDeclarations(text, "packages/ui/src/files/path.ts");
	assert.equal(found.length, 1);
	assert.equal(found[0]?.slug, "path-escape");
	assert.equal(found[0]?.rung, "7  sole-constructor type — parseFileName is the only producer");
	assert.equal(found[0]?.why, "a typed name can never reach outside its directory");
	assert.equal(found[0]?.debt, undefined);
	assert.equal(found[0]?.line, 3);
});

test("a wrapped field continues onto the next line, joined by one space", () => {
	const text = [
		"/**",
		" * @invariant two-tier-write",
		" * @rung 5  shared helper — replaceScreenLayout writes both tiers, but",
		" *          updateScreenCards is still public",
		" * @why  a replacement that writes one tier delivers a shredded layout",
		" * @debt remove updateScreenCards from the public ConfigStore interface",
		" */",
	].join("\n");
	const found = parseDeclarations(text, "packages/ui/src/config/store.ts");
	assert.equal(
		found[0]?.rung,
		"5  shared helper — replaceScreenLayout writes both tiers, but updateScreenCards is still public",
	);
	assert.equal(found[0]?.debt, "remove updateScreenCards from the public ConfigStore interface");
});

test("two blocks in one file are two declarations", () => {
	const text = "/**\n * @invariant one\n * @rung 6 a\n * @why b\n */\n/**\n * @invariant two\n * @rung 7 c\n * @why d\n */";
	assert.equal(parseDeclarations(text, "packages/ui/src/files/a.ts").length, 2);
});

test("a CSS block comment parses identically", () => {
	const text = "/* @invariant floor-independence\n * @rung 6 one declaration site\n * @why a card's minimum must not depend on its own width\n */";
	assert.equal(parseDeclarations(text, "packages/ui/src/app.css")[0]?.slug, "floor-independence");
});

test("RED CHECK: a typo'd tag is not silently accepted as a declaration", () => {
	const text = "/**\n * @invariants path-escape\n * @rung 7 x\n * @why y\n */";
	assert.deepEqual(parseDeclarations(text, "packages/ui/src/files/path.ts"), []);
});

test("text outside a block comment is never scanned", () => {
	const text = 'const s = "@invariant not-a-declaration";';
	assert.deepEqual(parseDeclarations(text, "packages/ui/src/files/path.ts"), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/invariants`: `node --test test/parse.test.ts`

Expected: FAIL — `Cannot find module '../src/parse.ts'`.

- [ ] **Step 3: Write the implementation**

`packages/invariants/src/parse.ts`:

```ts
/**
 * Extracts @invariant blocks. Deliberately dumb: it reports what is written,
 * including what is missing, and rules on nothing. Every validation rule lives
 * in check.ts so there is exactly one place to read them.
 *
 * Only /* ... *\/ block comments are scanned, so a string literal containing
 * "@invariant" is not a declaration. .ts, .tsx and .css all use this comment
 * form, which is why one scanner covers every file type.
 */
export interface RawDeclaration {
	readonly slug: string;
	readonly rung: string | undefined;
	readonly why: string | undefined;
	readonly debt: string | undefined;
	readonly file: string;
	readonly line: number;
}

const BLOCK = /\/\*[\s\S]*?\*\//g;
const TAG = /^@(invariant|rung|why|debt)\b\s*(.*)$/;

/** Strip a leading " * " (or "*") that block-comment lines conventionally carry. */
function stripGutter(line: string): string {
	return line.replace(/^\s*\*?\s?/, "").trimEnd();
}

export function parseDeclarations(text: string, file: string): RawDeclaration[] {
	const out: RawDeclaration[] = [];
	for (const block of text.matchAll(BLOCK)) {
		const startLine = text.slice(0, block.index).split("\n").length;
		const lines = block[0].split("\n");

		let slug: string | null = null;
		let fields: Record<string, string> = {};
		let current: string | null = null;
		let line = 0;

		const flush = (): void => {
			if (slug !== null) {
				out.push({
					slug,
					rung: fields["rung"],
					why: fields["why"],
					debt: fields["debt"],
					file,
					line,
				});
			}
			slug = null;
			fields = {};
			current = null;
		};

		for (let i = 0; i < lines.length; i++) {
			const body = stripGutter(lines[i]!);
			const tag = TAG.exec(body);
			if (tag !== null) {
				const name = tag[1]!;
				const value = tag[2]!.trim();
				if (name === "invariant") {
					flush(); // a second @invariant ends the first
					slug = value;
					line = startLine + i;
					current = null;
				} else if (slug !== null) {
					fields[name] = value;
					current = name;
				}
			} else if (current !== null && slug !== null && body !== "" && body !== "/") {
				// A continuation line: append, collapsing the indent to one space.
				fields[current] = `${fields[current] ?? ""} ${body.trim()}`.trim();
			}
		}
		flush();
	}
	return out;
}
```

> Note on the `body !== "/"` guard: `stripGutter` reduces the closing `*/` line to `/`, which must not be appended to the last field.

- [ ] **Step 4: Run the test to verify it passes**

Run from `packages/invariants`: `node --test test/parse.test.ts`

Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add packages/invariants
git commit -m "$(cat <<'EOF'
feat(invariants): parse the blocks, judge nothing

The parser reports what is written including what is absent, so every
validation rule can live in one place instead of being split across a
reader and a checker that drift.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U8FC79trVbPLvyfjbbsEd4
EOF
)"
```

---

## Task 3: Validate raw declarations into the branded `Declaration`

**Files:**
- Create: `packages/invariants/src/check.ts`
- Test: `packages/invariants/test/check.test.ts`

**Interfaces:**
- Consumes: `RawDeclaration` and `parseDeclarations` (Task 2), `namespaceOf` (Task 1).
- Produces:
  ```ts
  export interface Problem { readonly file: string; readonly line: number; readonly message: string; }
  declare const valid: unique symbol;
  export type Declaration = {
      readonly id: string; readonly namespace: string; readonly slug: string;
      readonly rung: number; readonly mechanism: string; readonly why: string;
      readonly debt: string | undefined;
      readonly file: string; readonly line: number;
  } & { readonly [valid]: true };
  export function checkAll(raw: readonly RawDeclaration[]): { declarations: Declaration[]; problems: Problem[] };
  export const MIN_RUNG = 6;
  ```
  `checkAll` is the **sole producer** of `Declaration`. No other module can construct one, so `render` in Task 5 cannot be handed an unvalidated declaration — that is a compile error, not a review note.

- [ ] **Step 1: Write the failing test**

`packages/invariants/test/check.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAll } from "../src/check.ts";
import type { RawDeclaration } from "../src/parse.ts";

const raw = (over: Partial<RawDeclaration> = {}): RawDeclaration => ({
	slug: "sample",
	rung: "7  sole-constructor type — the only producer is parseX",
	why: "something bad cannot happen",
	debt: undefined,
	file: "packages/ui/src/files/path.ts",
	line: 10,
	...over,
});

const messages = (input: readonly RawDeclaration[]): string[] =>
	checkAll(input).problems.map(p => p.message);

test("a good declaration validates and gets its derived id", () => {
	const { declarations, problems } = checkAll([raw()]);
	assert.deepEqual(problems, []);
	assert.equal(declarations[0]?.id, "files/sample");
	assert.equal(declarations[0]?.namespace, "files");
	assert.equal(declarations[0]?.rung, 7);
	assert.equal(declarations[0]?.mechanism, "sole-constructor type — the only producer is parseX");
});

test("a duplicate id within one namespace is rejected", () => {
	const both = [raw(), raw({ file: "packages/ui/src/files/other.ts", line: 3 })];
	assert.match(messages(both).join(), /duplicate/i);
});

test("the same slug in DIFFERENT namespaces is fine", () => {
	const ok = [raw(), raw({ file: "packages/ui/src/om/estimates.ts" })];
	assert.deepEqual(checkAll(ok).problems, []);
});

test("a missing @rung is rejected", () => {
	assert.match(messages([raw({ rung: undefined })]).join(), /@rung/);
});

test("a missing @why is rejected", () => {
	assert.match(messages([raw({ why: undefined })]).join(), /@why/);
});

test("a rung outside 0-8 is rejected", () => {
	assert.match(messages([raw({ rung: "9 something" })]).join(), /0-8/);
});

test("a rung number with no named mechanism is rejected", () => {
	assert.match(messages([raw({ rung: "7" })]).join(), /mechanism/i);
});

test("rung below 6 with no @debt is rejected", () => {
	assert.match(messages([raw({ rung: "3  a test pins it" })]).join(), /@debt/);
});

test("rung below 6 WITH a promotion is accepted as filed debt", () => {
	const debt = raw({ rung: "3  a test pins it", debt: "brand the parameter so a bypass is a compile error" });
	assert.deepEqual(checkAll([debt]).problems, []);
	assert.equal(checkAll([debt]).declarations[0]?.debt, "brand the parameter so a bypass is a compile error");
});

test("@debt on a rung >= 6 declaration is rejected — there is nothing to promote", () => {
	assert.match(messages([raw({ debt: "tidy this up sometime" })]).join(), /rung 6/);
});

test("an empty @debt is not a promotion", () => {
	assert.match(messages([raw({ rung: "2 an assert", debt: "" })]).join(), /@debt/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/invariants`: `node --test test/check.test.ts`

Expected: FAIL — `Cannot find module '../src/check.ts'`.

- [ ] **Step 3: Write the implementation**

`packages/invariants/src/check.ts`:

```ts
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
		if (rung >= MIN_RUNG && debt !== undefined) {
			fail(`"${id}" is at rung ${rung} and carries @debt — at or above rung ${MIN_RUNG} there is nothing to promote`);
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `packages/invariants`: `node --test test/check.test.ts`

Expected: PASS, 11/11.

- [ ] **Step 5: Commit**

```bash
git add packages/invariants
git commit -m "$(cat <<'EOF'
feat(invariants): a Declaration only the checker can make

Branding the validated shape means render() cannot be handed an unchecked
declaration — the bypass is a compile error rather than a convention.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U8FC79trVbPLvyfjbbsEd4
EOF
)"
```

---

## Task 4: Scan the workspace

**Files:**
- Create: `packages/invariants/src/scan.ts`
- Test: `packages/invariants/test/scan.test.ts`

**Interfaces:**
- Consumes: `parseDeclarations` (Task 2).
- Produces: `scanTree(rootDir: string): RawDeclaration[]` — walks **`<rootDir>/packages/*/src` only**, returns declarations in a **deterministic** order (files sorted by repo-relative path, declarations in file order). `repoRoot(): string` resolves the repo root from this module's location so the CLI and tests agree on one answer.

> **Deviation recorded during execution (2026-07-31).** The plan originally said "walks `<rootDir>/packages`". Running the first build against the real repo showed this package's own test fixtures being extracted as declarations: a fixture string containing literal `/* … */` text is indistinguishable from a comment to a regex over raw bytes. Narrowed to `packages/*/src`, which is the right rule on meaning anyway — a declaration belongs beside the mechanism, and a test is evidence *about* a mechanism, not one. Two extra tests pin it.

- [ ] **Step 1: Write the failing test**

`packages/invariants/test/scan.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanTree, repoRoot } from "../src/scan.ts";

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "inv-"));
	const ui = join(root, "packages", "ui", "src", "files");
	mkdirSync(ui, { recursive: true });
	writeFileSync(join(ui, "path.ts"), "/**\n * @invariant path-escape\n * @rung 7 brand\n * @why safety\n */");
	writeFileSync(join(ui, "a.css"), "/* @invariant floor\n * @rung 6 one site\n * @why layout\n */");
	writeFileSync(join(ui, "notes.md"), "@invariant not-scanned\n");
	const skipped = join(root, "packages", "ui", "node_modules", "dep");
	mkdirSync(skipped, { recursive: true });
	writeFileSync(join(skipped, "x.ts"), "/**\n * @invariant vendor\n * @rung 7 x\n * @why y\n */");
	return root;
}

test("scans ts/tsx/css under packages, and nothing else", () => {
	const found = scanTree(fixture());
	const slugs = found.map(d => d.slug).sort();
	assert.deepEqual(slugs, ["floor", "path-escape"]);
});

test("node_modules is never scanned", () => {
	assert.equal(scanTree(fixture()).some(d => d.slug === "vendor"), false);
});

test("paths are repo-relative with forward slashes on every platform", () => {
	const found = scanTree(fixture());
	assert.equal(found.every(d => d.file.startsWith("packages/") && !d.file.includes("\\")), true);
});

test("the order is deterministic across runs", () => {
	const root = fixture();
	assert.deepEqual(scanTree(root).map(d => d.file), scanTree(root).map(d => d.file));
});

test("repoRoot finds the real workspace", () => {
	assert.equal(typeof repoRoot(), "string");
	assert.match(repoRoot().replaceAll("\\", "/"), /dwc-ng$/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/invariants`: `node --test test/scan.test.ts`

Expected: FAIL — `Cannot find module '../src/scan.ts'`.

- [ ] **Step 3: Write the implementation**

`packages/invariants/src/scan.ts`:

```ts
/**
 * Walks the workspace collecting declarations. Sorted output, because the
 * register is compared byte-for-byte by the drift test — a filesystem whose
 * readdir order differs between machines must not produce a different file.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDeclarations, type RawDeclaration } from "./parse.ts";

const EXTENSIONS = [".ts", ".tsx", ".css"];
const SKIP = new Set(["node_modules", "dist", ".git", "captures"]);

/** This file is packages/invariants/src/scan.ts, so the root is three up. */
export function repoRoot(): string {
	return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function walk(dir: string, out: string[]): void {
	const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
	for (const entry of entries) {
		if (SKIP.has(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (EXTENSIONS.some(ext => entry.name.endsWith(ext))) out.push(full);
	}
}

export function scanTree(rootDir: string): RawDeclaration[] {
	const files: string[] = [];
	walk(join(rootDir, "packages"), files);
	const out: RawDeclaration[] = [];
	for (const full of files.sort()) {
		const rel = relative(rootDir, full).replaceAll("\\", "/");
		out.push(...parseDeclarations(readFileSync(full, "utf8"), rel));
	}
	return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `packages/invariants`: `node --test test/scan.test.ts`

Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add packages/invariants
git commit -m "$(cat <<'EOF'
feat(invariants): walk the workspace in an order that cannot vary

The register is compared byte-for-byte, so readdir order differing between
machines must not be able to produce a different file.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U8FC79trVbPLvyfjbbsEd4
EOF
)"
```

---

## Task 5: Render the register

**Files:**
- Create: `packages/invariants/src/render.ts`
- Test: `packages/invariants/test/render.test.ts`

**Interfaces:**
- Consumes: `Declaration`, `MIN_RUNG` (Task 3).
- Produces: `renderRegister(declarations: readonly Declaration[], ceiling: number): string` — the complete markdown bytes, ending with exactly one trailing newline.

- [ ] **Step 1: Write the failing test**

`packages/invariants/test/render.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAll } from "../src/check.ts";
import { renderRegister } from "../src/render.ts";
import type { RawDeclaration } from "../src/parse.ts";

const raw = (over: Partial<RawDeclaration> = {}): RawDeclaration => ({
	slug: "sample",
	rung: "7  brand — one producer",
	why: "a bad state cannot be written",
	debt: undefined,
	file: "packages/ui/src/files/path.ts",
	line: 10,
	...over,
});

const render = (input: readonly RawDeclaration[], ceiling = 0): string =>
	renderRegister(checkAll(input).declarations, ceiling);

test("the generated header warns the file is not to be edited", () => {
	assert.match(render([raw()]), /DO NOT EDIT/);
});

test("the preamble states the honest limit on discovery", () => {
	assert.match(render([raw()]), /completeness of discovery is rung 4/i);
});

test("declarations are grouped under their namespace with id, rung and why", () => {
	const out = render([raw()]);
	assert.match(out, /## files/);
	assert.match(out, /files\/sample/);
	assert.match(out, /rung 7/);
	assert.match(out, /a bad state cannot be written/);
});

test("a debt row shows its promotion so the reader sees the way out", () => {
	const out = render([raw({ rung: "3  a test pins it", debt: "brand the parameter" })], 1);
	assert.match(out, /brand the parameter/);
});

test("totals count the debts and name the ceiling", () => {
	const out = render([raw(), raw({ slug: "other", rung: "2  an assert", debt: "seal the route" })], 4);
	assert.match(out, /2 invariants/);
	assert.match(out, /1 below rung 6/);
	assert.match(out, /ceiling 4/);
});

test("output is stable regardless of input order, and ends in one newline", () => {
	const a = render([raw(), raw({ slug: "zzz" })]);
	const b = render([raw({ slug: "zzz" }), raw()]);
	assert.equal(a, b);
	assert.equal(a.endsWith("\n"), true);
	assert.equal(a.endsWith("\n\n"), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/invariants`: `node --test test/render.test.ts`

Expected: FAIL — `Cannot find module '../src/render.ts'`.

- [ ] **Step 3: Write the implementation**

`packages/invariants/src/render.ts`:

```ts
/**
 * The register's bytes. Sorted here rather than at the call site so the output
 * cannot depend on how the declarations arrived.
 */
import { MIN_RUNG, type Declaration } from "./check.ts";

export function renderRegister(declarations: readonly Declaration[], ceiling: number): string {
	const sorted = [...declarations].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const debts = sorted.filter(d => d.rung < MIN_RUNG);

	const lines: string[] = [
		"# Invariant register",
		"",
		"> **Generated by `packages/invariants` — DO NOT EDIT.**",
		"> Declarations live beside the mechanisms that enforce them; regenerate with",
		"> `pnpm --filter @dwc-ng/invariants generate`.",
		"",
		"Every invariant this repo knows about, extracted from the `@invariant` blocks",
		"in source. An invariant is a property that must hold across all executions,",
		"whose violation is a defect rather than a preference.",
		"",
		"**Completeness of discovery is rung 4.** No generator can detect an invariant",
		"nobody wrote down. A lint catches the syntactic tells (\"callers must\",",
		"\"should\", \"by convention\"); everything past that is human judgement. This",
		"register is exhaustive over what has been *declared*, not over what exists.",
		"",
		`**Totals:** ${sorted.length} invariants · ${sorted.length - debts.length} at rung ${MIN_RUNG} or above · ` +
			`${debts.length} below rung ${MIN_RUNG} (ceiling ${ceiling}).`,
		"",
	];

	let namespace = "";
	for (const d of sorted) {
		if (d.namespace !== namespace) {
			namespace = d.namespace;
			lines.push(`## ${namespace}`, "");
		}
		lines.push(`### \`${d.id}\` — rung ${d.rung}`, "");
		lines.push(`**Mechanism.** ${d.mechanism}`, "");
		lines.push(`**Why.** ${d.why}`, "");
		if (d.debt !== undefined) lines.push(`**Debt — promotion.** ${d.debt}`, "");
		lines.push(`\`${d.file}:${d.line}\``, "");
	}

	return `${lines.join("\n").trimEnd()}\n`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `packages/invariants`: `node --test test/render.test.ts`

Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add packages/invariants
git commit -m "$(cat <<'EOF'
feat(invariants): render the register, and say what it cannot promise

The preamble states that completeness of discovery is rung 4. An
unlabelled gap reads as protection and gets trusted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U8FC79trVbPLvyfjbbsEd4
EOF
)"
```

---

## Task 6: The CLI, the drift gate and the ratchet

**Files:**
- Create: `packages/invariants/src/cli.ts`
- Create: `packages/invariants/debt-ceiling.json`
- Create: `packages/invariants/test/gate.test.ts`
- Create: `docs/invariant-register.md` (by running the generator — never by hand)

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: `buildRegister(): { markdown: string; declarations: Declaration[]; problems: Problem[]; ceiling: number }` exported from `cli.ts` so the gate tests use the same path the CLI does, not a re-implementation of it.

- [ ] **Step 1: Create the ceiling file at zero**

`packages/invariants/debt-ceiling.json`:

```json
{ "ceiling": 0 }
```

> Task 8 raises this once, to the number the migrated ledger row requires. Task 9+ raise it only as the sweep discovers real debt. It goes back to 0 at the end of Phase 2.

- [ ] **Step 2: Write the failing test**

`packages/invariants/test/gate.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRegister } from "../src/cli.ts";
import { repoRoot } from "../src/scan.ts";
import { MIN_RUNG } from "../src/check.ts";

test("every declaration in the repo is valid", () => {
	const { problems } = buildRegister();
	assert.deepEqual(problems.map(p => `${p.file}:${p.line} ${p.message}`), []);
});

test("DRIFT: the committed register matches what the generator produces", () => {
	const { markdown } = buildRegister();
	const committed = readFileSync(join(repoRoot(), "docs", "invariant-register.md"), "utf8");
	assert.equal(
		committed,
		markdown,
		"docs/invariant-register.md is stale — run `pnpm --filter @dwc-ng/invariants generate`",
	);
});

test("RATCHET: the debt count never exceeds the committed ceiling", () => {
	const { declarations, ceiling } = buildRegister();
	const debts = declarations.filter(d => d.rung < MIN_RUNG);
	assert.ok(
		debts.length <= ceiling,
		`${debts.length} invariants sit below rung ${MIN_RUNG} but the ceiling is ${ceiling}. ` +
			`Promote one, or raise the ceiling in packages/invariants/debt-ceiling.json as a deliberate act: ` +
			debts.map(d => d.id).join(", "),
	);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run from `packages/invariants`: `node --test test/gate.test.ts`

Expected: FAIL — `Cannot find module '../src/cli.ts'`.

- [ ] **Step 4: Write the implementation**

`packages/invariants/src/cli.ts`:

```ts
/**
 * `generate` writes the register; `check` reports without writing. Both go
 * through buildRegister, and so do the gate tests — one assembly path, so a
 * green test cannot mean something different from a green CLI.
 */
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanTree, repoRoot } from "./scan.ts";
import { checkAll, type Declaration, type Problem } from "./check.ts";
import { renderRegister } from "./render.ts";

const REGISTER = ["docs", "invariant-register.md"];
const CEILING = ["packages", "invariants", "debt-ceiling.json"];

function readCeiling(root: string): number {
	const parsed: unknown = JSON.parse(readFileSync(join(root, ...CEILING), "utf8"));
	if (typeof parsed !== "object" || parsed === null || !("ceiling" in parsed)) {
		throw new Error("debt-ceiling.json must be { \"ceiling\": <integer> }");
	}
	const value = (parsed as { ceiling: unknown }).ceiling;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw new Error(`debt-ceiling.json has a non-integer ceiling: ${String(value)}`);
	}
	return value;
}

export function buildRegister(): {
	markdown: string;
	declarations: Declaration[];
	problems: Problem[];
	ceiling: number;
} {
	const root = repoRoot();
	const ceiling = readCeiling(root);
	const { declarations, problems } = checkAll(scanTree(root));
	return { markdown: renderRegister(declarations, ceiling), declarations, problems, ceiling };
}

function main(): void {
	const command = process.argv[2] ?? "check";
	const { markdown, problems } = buildRegister();
	for (const p of problems) console.error(`${p.file}:${p.line}  ${p.message}`);
	if (command === "generate") {
		if (problems.length > 0) {
			console.error("Refusing to generate with unresolved problems.");
			process.exit(1);
		}
		writeFileSync(join(repoRoot(), ...REGISTER), markdown);
		console.log(`Wrote ${REGISTER.join("/")}`);
		return;
	}
	if (problems.length > 0) process.exit(1);
	console.log("Declarations valid.");
}

/**
 * Run main() ONLY when this file was invoked as the program — never when the
 * gate tests import buildRegister from it. `import.meta.url` alone cannot tell
 * the difference (it always ends with cli.ts), and getting this wrong would
 * have the test suite call process.exit mid-run.
 */
const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) main();
```

- [ ] **Step 5: Generate the register for the first time**

Run from the repo root: `pnpm --filter @dwc-ng/invariants generate`

Expected: `Wrote docs/invariant-register.md`. The file will show `0 invariants` — nothing is declared yet. That is correct at this point.

- [ ] **Step 6: Run the tests to verify they pass**

Run from `packages/invariants`: `node --test`

Expected: PASS across all five test files.

- [ ] **Step 7: Prove the drift gate can fail (red check)**

```bash
printf '\nstray line\n' >> docs/invariant-register.md
```
Run from `packages/invariants`: `node --test test/gate.test.ts`
Expected: **FAIL** on the DRIFT test, with the "run generate" message.

Then restore: `pnpm --filter @dwc-ng/invariants generate`, re-run, expect PASS.

- [ ] **Step 8: Prove the ratchet can fail (red check)**

Temporarily append to `packages/invariants/src/paths.ts`:

```ts
/**
 * @invariant temporary-red-check
 * @rung 2  a runtime throw, and only on the path that runs
 * @why proves the ratchet fails when debt exceeds the ceiling
 * @debt delete this block; it exists only to red-check the gate
 */
```
Run from `packages/invariants`: `node --test test/gate.test.ts`
Expected: **FAIL** on RATCHET — 1 debt against a ceiling of 0, naming `paths/temporary-red-check`.

Delete the block, regenerate, re-run, expect PASS.

- [ ] **Step 9: Confirm the gate rides the root test command**

Run from the repo root: `pnpm test`

Expected: the `@dwc-ng/invariants` tests appear alongside ui, mock-duet and deploy. No new command was added anywhere, and nobody has to remember one.

- [ ] **Step 10: Typecheck**

Run from the repo root: `pnpm typecheck`

Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add packages/invariants docs/invariant-register.md
git commit -m "$(cat <<'EOF'
feat(invariants): the drift gate and the debt ratchet

The gate rides `pnpm test`, so there is no new command to forget. The
ratchet is a single committed integer: down is free, up is a digit
changing in a diff. A gate that merely permits @debt is an allowlist,
and allowlists grow silently.

Both red-checked: a stray line in the register fails DRIFT, and a
rung-2 declaration against a ceiling of 0 fails RATCHET.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U8FC79trVbPLvyfjbbsEd4
EOF
)"
```

---

## Task 7: The red-flag lint

**Files:**
- Create: `packages/invariants/src/redFlags.ts`
- Test: `packages/invariants/test/redFlags.test.ts`
- Modify: `packages/invariants/src/cli.ts` (add the `flags` command)

**Interfaces:**
- Consumes: `scanTree`, `repoRoot`.
- Produces: `findRedFlags(rootDir: string): Problem[]` — one problem per red-flag phrase found in a source comment that is **not** inside a block already carrying an `@invariant` tag.

Rationale: this is the rung-4 mitigation from spec §6. It cannot find an invariant nobody wrote down; it finds the sentences people write *instead of* declaring one.

- [ ] **Step 1: Write the failing test**

`packages/invariants/test/redFlags.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRedFlags } from "../src/redFlags.ts";

function withSource(body: string): string {
	const root = mkdtempSync(join(tmpdir(), "flags-"));
	const dir = join(root, "packages", "ui", "src", "files");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "x.ts"), body);
	return root;
}

test("an undeclared red-flag phrase is reported", () => {
	const found = findRedFlags(withSource("/**\n * Callers must sort the list first.\n */"));
	assert.equal(found.length, 1);
	assert.match(found[0]!.message, /callers must/i);
});

test("the same phrase inside a declared block is NOT reported", () => {
	const body = "/**\n * @invariant sorted\n * @rung 3 a test pins it\n * @why order matters\n * @debt take a Sorted<T>\n * Callers must sort the list first.\n */";
	assert.deepEqual(findRedFlags(withSource(body)), []);
});

test("every phrase from the skill's list is detected", () => {
	for (const phrase of ["by convention", "callers must", "guaranteed by", "in practice", "should not"]) {
		const found = findRedFlags(withSource(`/**\n * Note: ${phrase} something.\n */`));
		assert.equal(found.length, 1, `"${phrase}" was not detected`);
	}
});

test("ordinary prose is left alone", () => {
	assert.deepEqual(findRedFlags(withSource("/**\n * Loads the file and returns its text.\n */")), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/invariants`: `node --test test/redFlags.test.ts`

Expected: FAIL — `Cannot find module '../src/redFlags.ts'`.

- [ ] **Step 3: Write the implementation**

`packages/invariants/src/redFlags.ts`:

```ts
/**
 * Rung 4, and it says so. This finds the sentences people write INSTEAD of a
 * declaration — the phrases the skill lists as obliging a promotion or a ledger
 * row. It cannot find an invariant nobody wrote down at all; nothing can.
 *
 * A block that already carries @invariant is exempt: there the phrase is
 * describing filed debt, which is the outcome we want.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Problem } from "./check.ts";

const PHRASES = [
	"by convention",
	"callers must",
	"caller must",
	"guaranteed by",
	"in practice",
	"should not",
	"must remember",
	"remember to",
	"hand-maintained",
	"kept beside",
];

const BLOCK = /\/\*[\s\S]*?\*\//g;
const EXTENSIONS = [".ts", ".tsx", ".css"];
const SKIP = new Set(["node_modules", "dist", ".git", "captures", "test"]);

function walk(dir: string, out: string[]): void {
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
		if (SKIP.has(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (EXTENSIONS.some(ext => entry.name.endsWith(ext))) out.push(full);
	}
}

export function findRedFlags(rootDir: string): Problem[] {
	const files: string[] = [];
	walk(join(rootDir, "packages"), files);
	const out: Problem[] = [];
	for (const full of files.sort()) {
		const text = readFileSync(full, "utf8");
		const file = relative(rootDir, full).replaceAll("\\", "/");
		for (const block of text.matchAll(BLOCK)) {
			const body = block[0];
			if (body.includes("@invariant")) continue; // filed debt may say these things
			const lower = body.toLowerCase();
			for (const phrase of PHRASES) {
				if (!lower.includes(phrase)) continue;
				out.push({
					file,
					line: text.slice(0, block.index).split("\n").length,
					message: `"${phrase}" without an @invariant declaration — promote it or file it as debt`,
				});
			}
		}
	}
	return out;
}
```

- [ ] **Step 4: Add the `flags` command to the CLI**

In `packages/invariants/src/cli.ts`, add the import and a branch inside `main()` before the `generate` branch:

```ts
import { findRedFlags } from "./redFlags.ts";
```

```ts
	if (command === "flags") {
		const flags = findRedFlags(repoRoot());
		for (const f of flags) console.error(`${f.file}:${f.line}  ${f.message}`);
		console.log(`${flags.length} red-flag phrases without a declaration.`);
		return;
	}
```

- [ ] **Step 5: Run the test to verify it passes**

Run from `packages/invariants`: `node --test test/redFlags.test.ts`

Expected: PASS, 4/4.

- [ ] **Step 6: Take the baseline reading**

Run from the repo root: `pnpm --filter @dwc-ng/invariants exec node src/cli.ts flags`

Record the count in the commit message. **Do not gate on it yet** — the sweep will drive it down, and a gate set before the sweep would only ever be suppressed. It becomes a gate in Task 20.

- [ ] **Step 7: Commit**

```bash
git add packages/invariants
git commit -m "$(cat <<'EOF'
feat(invariants): find the sentences written instead of a declaration

Rung 4, and the register says so. This catches the syntactic tells, not
the silent ones — an invariant nobody perceived cannot be found by any
machine, and pretending otherwise would be the worse failure.

Reporting only for now; gating before the sweep would only teach people
to suppress it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U8FC79trVbPLvyfjbbsEd4
EOF
)"
```

---

## Task 8: Migrate the existing ledger and delete it

**Files:**
- Modify: `packages/ui/src/config/store.ts` (the doc comment at ~line 75)
- Modify: `packages/invariants/debt-ceiling.json`
- Delete: `docs/invariant-ledger.md`
- Modify: `docs/superpowers/specs/2026-07-24-*.md` and any doc citing the ledger path — repoint to `docs/invariant-register.md`

- [ ] **Step 1: Find every reference to the old ledger**

```bash
rg -n "invariant-ledger" --glob '!node_modules'
```

Record the list; every hit must be repointed or deleted in this task.

- [ ] **Step 2: Add the declaration**

In `packages/ui/src/config/store.ts`, replace the existing `LEDGER — invariant at rung 5 (see docs/invariant-ledger.md)` comment above `updateScreenCards` with:

```ts
	/**
	 * @invariant screen-layout-two-tier
	 * @rung 5  shared helper — replaceScreenLayout (compose/screens.ts) writes both
	 *          the config overlay and the per-browser canvas store, but
	 *          updateScreenCards remains public with four direct callers, all
	 *          correct only by inspection
	 * @why a screen's geometry lives in two tiers and mergeCanvas assembles what
	 *      renders card by card, so a replacement writing one tier alone delivers
	 *      a shredded layout — reported 2026-07-24 as "machine import didn't work"
	 * @debt remove updateScreenCards from the public ConfigStore interface and
	 *       expose two named intents instead — updateScreenMembership(id, cards)
	 *       for incremental changes and replaceScreenLayout(id, rects) for
	 *       wholesale ones — so "write geometry without saying which kind of
	 *       change this is" has no encoding. Scope: one interface change plus
	 *       four call sites.
	 */
```

- [ ] **Step 3: Raise the ceiling to 1, deliberately**

`packages/invariants/debt-ceiling.json`:

```json
{ "ceiling": 1 }
```

- [ ] **Step 4: Regenerate and verify**

```bash
pnpm --filter @dwc-ng/invariants generate
pnpm --filter @dwc-ng/invariants test
```

Expected: PASS. The register now shows `1 invariants · 0 at rung 6 or above · 1 below rung 6 (ceiling 1)`.

- [ ] **Step 5: Delete the old ledger**

```bash
git rm docs/invariant-ledger.md
```

Repoint every reference found in Step 1 to `docs/invariant-register.md`.

- [ ] **Step 6: Verify nothing still points at a deleted file**

```bash
rg -n "invariant-ledger" --glob '!node_modules'
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(invariants): the ledger's one row moves next to the code

Deleting docs/invariant-ledger.md rather than leaving it: an unused
alternative is a rung-0 invitation to file rows somewhere nothing
generates from, which is how its three predecessors were lost.

Ceiling raised 0 -> 1 deliberately, for the layout two-tier debt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U8FC79trVbPLvyfjbbsEd4
EOF
)"
```

---

## Tasks 9–19: The sweep

**One task per module, in risk order.** Every sweep task follows the identical procedure below; only the file list and the seeds differ. A task is complete when `pnpm --filter @dwc-ng/invariants test` is green and the module's every invariant is declared at its **true current rung**.

### The procedure (applies to Tasks 9–19)

- [ ] **Step A: Read every file in the module.** Not skim. The invariant you are looking for is usually the reason a function exists at all.

- [ ] **Step B: For each candidate, apply the definition.** From spec §2: a property that must hold across all executions, whose violation is a defect rather than a preference, and for which some identifiable mechanism is responsible. Style, naming and performance targets are **not** invariants — leave them out rather than padding the register.

- [ ] **Step C: Assign the rung from the mechanism you can point at.** Skill rule 9. If you cannot name the mechanism, the rung is 0 — write 0. A flattering rung is worse than no declaration, because it is trusted.

  Ladder, short: 0 comment · 1 convention · 2 runtime assert · 3 tests · 4 lint · 5 shared helper · 6 choke-point · 7 sole-constructor type · 8 illegal state unrepresentable.

  Watch for anti-pattern A5.11 in particular: "by construction, pinned by a test" is **rung 3**, not 7.

- [ ] **Step D: Write the declaration** above the mechanism, using the format from Task 8's example. Rung < 6 requires `@debt` naming a *specific* promotion — "improve this" is not a promotion; "brand the parameter so producers are commands.ts and ack.ts only" is.

- [ ] **Step E: If a declaration turns out to be false** — the claim is made but the mechanism does not actually hold it — **stop and file it as a bug**. Do not declare it at a rung it does not occupy. This is the most valuable thing the sweep can find.

- [ ] **Step F: Raise the ceiling by exactly the number of new debts** in this module. One commit, one visible digit.

- [ ] **Step G: Regenerate, test, commit.**

```bash
pnpm --filter @dwc-ng/invariants generate
pnpm --filter @dwc-ng/invariants test
pnpm typecheck
git add -A && git commit   # message names the module, the count, and the ceiling delta
```

### Task 9: `connector` — highest risk

**Files:** `packages/ui/src/connector/*.ts` (types, createConnector, PollConnector, DsfConnector, dsfModel, emergency, transport)

**Seeds already identified — verify each before declaring, and do not assume this list is complete:**

| Candidate | Where | Expected mechanism |
|---|---|---|
| sole connector construction (design D9/C1) | `createConnector.ts:2` | one route — likely rung 6 |
| e-stop is never queued behind a gated write | `connector/emergency.ts` | check whether the unqueued path is reachable another way |
| no raw transport use | `test/no-raw-transport.test.ts` | a fence **test** — that is rung 3, say so |
| `sendCode` takes an unbranded string | `types.ts:131` | **rung 3 + `@debt`** — the audit's unkept rung-7 promise; the promotion is a branded `GcodeCommand` whose producers are commands.ts, ack.ts, `resolveTemplate`, one console escape hatch, and the operator-owned probe template |
| DSF model merge purity (C2) | `dsfModel.ts:3` | no I/O, no Solid, no timers |
| ping/pong masking fix | `DsfConnector.ts:274` | read the comment; decide whether a mechanism exists or only a fix |

### Task 10: `control` — hardware safety

**Files:** `packages/ui/src/control/` — nine files: `commands.ts`, `armed.ts`, `pinSender.ts`, `setpointCommit.ts`, `speedScale.ts`, `toolP.ts`, `GcodeButton.tsx`, `SpeedSlider.tsx`, `FilamentCard.tsx`. The write guard itself lives at `packages/ui/src/dev/writeGuard.ts` — declare it in **Task 16**, not here, so it sits beside its own mechanism.

**Seeds:** `gcodeQuote` as the one quoting authority (M98 injection was killed here — check whether a second quoting route exists); `armed.ts`'s arm-then-activate two-step; `setpointCommit.ts`; every command builder being the sole producer of its G-code string; `GcodeButton` as the intended sole route for command buttons (which is what makes ActiveJobCard's four raw buttons in Task 17 a real bypass rather than a style nit).

> Use the **duet-gcode** skill for any command form you need to verify. Never from memory. `commands.ts` + `reference/dwc` are the authority on emitted strings.

### Task 11: `config` — parse boundary and overlay

**Files:** `packages/ui/src/config/` — exactly three files: `parse.ts`, `store.ts`, `types.ts`

**Seeds:** the per-section parse boundary + version gate (`config/parse.ts`); `mintId` as the one branded id; `resetSection` type-excluding creations; the two-tier write (already declared in Task 8 — do not duplicate it); the `apply()` single-mutation-path + dirty flag from `a0a1037`.

### Task 12: `files`

**Files:** `packages/ui/src/files/*.ts(x)`

**Seeds:** `FileName` brand (`path.ts:15-19`) — a real rung 7; `FilePlan` brand (`browser.ts:97-108`) making a hand-built plan a compile error — rung 7; the "two structural invariants" the header of `browser.ts:7` names but does not enumerate; `browserMemory`'s stored directory being **untrusted on the way back in** and re-validated via `dirUnderRoot`; the `MAX_SCROLL_DIRS` bound.

### Task 13: `compose`

**Files:** `packages/ui/src/compose/**` including `controls/`

**Seeds:** I1–I16 from `docs/composable-cards-design.md` — migrate each into a declaration beside its mechanism, then **repoint that document** to cite ids instead of numbering independently. `OmSelector` (I14: bindings are selectors, never executable), `CompiledTemplate`, the control `spec` brand, the weld against the actual compiled specs, `exportScreen` dropping unparseable cards.

### Task 14: `om`

**Files:** `packages/ui/src/om/*.ts`

**Seeds:** `heaterSeries.ts:4` no-two-heater-lines-alike; `conformModelKey` as the per-key shape gate at the OM entry; `estimates.ts:12` "most trustworthy AVAILABLE source"; `commandHistory` / `consoleLog` bounds.

### Task 15: `shell`

**Files:** `packages/ui/src/shell/*.ts(x)`

**Seeds:** `panelCanvas.ts` collision rejection (no auto-settle); `growToDefaults` + `reflow` termination and idempotence — the header claims both "by construction", so **verify the claim before recording the rung**; grid metrics emitted from constants with the CSS copy deleted (technique 14 — a generator, so check whether it really is one); `edgeScroll`'s opt-in count test (rung 3); `railSlot`'s single portal target.

### Task 16: `dev` and the layout oracle

**Files:** `packages/ui/src/dev/*.ts(x)`

**Seeds:** Invariant A (`layoutAudit.ts:31`) and Invariant B (`:152`) — these are *audited* properties of cards, so the declaration belongs on the checker, and the rung is whatever the checker actually is. Note the known limitation already recorded on 2026-07-31: Card Lab state pills do not change the bench, so ten cards are audited empty — that limitation belongs in the `@why` or as a separate debt.

Also here: **`dev/writeGuard.ts`**. Per A5.13 the declaration must **name the profile it works in** — the 2026-07-22 audit records it as "dev-only by design — documented, not a gap", so the `@why` must say exactly that rather than implying it guards production. If nothing defends the production profile, say what does instead.

### Task 17: `cards`

**Files:** `packages/ui/src/cards/*.tsx`

**Seeds:** ActiveJobCard's four raw `<button>`s versus `GcodeButton` — the audit's second unkept promise; the two-click arm-then-activate on heaters; the read-only file guard. Most cards are presentational and will have **no** invariants; do not invent any.

### Task 18: `app.css` and layout

**Files:** `packages/ui/src/app.css`

**Seeds:** the positional-selector guard (`4bc786e`); "a card's reported minimum must not depend on its own width"; the `--row-unit` density pitches; the media-query source-order rule that cost four wrong diagnoses (see memory `dev-vs-device-check-breakpoints`) — if that is currently held by nothing, it is **rung 0 with a debt**, and the honest promotion is generating the breakpoint block from one typed source.

### Task 19: `deploy` and `mock-duet`

**Files:** `packages/deploy/src/*.ts`, `packages/mock-duet/src/*.ts`

**Seeds:** compression derived from the **serving stack**, not the transport (`e7f792c` — and CLAUDE.md records the 2026-07-24 verification that a `.gz` deploy 404s every asset under DuetWebServer, so this one is load-bearing); `assertBaseMatchesLayout`; `ownedPaths` as the sole authority on what an uninstall may delete; recursive delete (`95138fc`) — and note the fake transport must stay *at least as strict as the board*, which is itself an invariant worth declaring after that bug; mock-duet's `ws.ts:3` sole byte-level framing route (C13).

---

## Task 20: Close Phase 1

**Files:**
- Modify: `packages/invariants/src/cli.ts` (gate on red flags)
- Create: `packages/invariants/test/redFlagGate.test.ts`
- Modify: `docs/superpowers/specs/2026-07-31-invariant-coverage-design.md` (record the measured outcome)

- [ ] **Step 1: Re-read the red-flag count**

```bash
pnpm --filter @dwc-ng/invariants exec node src/cli.ts flags
```

- [ ] **Step 2: Add a red-flag ceiling on the same ratchet pattern**

Extend `debt-ceiling.json` to `{ "ceiling": <n>, "redFlagCeiling": <m> }` where `<m>` is the count from Step 1, and add `packages/invariants/test/redFlagGate.test.ts` asserting `findRedFlags(repoRoot()).length <= redFlagCeiling` with a message listing the offenders. Update `readCeiling` to read both, rejecting a missing or non-integer `redFlagCeiling` exactly as it does `ceiling`.

- [ ] **Step 3: Record the measured Phase 2 scope**

Append a "Phase 1 outcome" section to the spec with the real numbers: total invariants declared, count at rung ≥ 6, count below, the opening ceiling, the red-flag ceiling, and any invariants found to be **claimed but not enforced** (Step E of the sweep) with the bug filed for each.

- [ ] **Step 4: Full verification**

```bash
pnpm test
pnpm typecheck
```

Expected: all green, exit 0.

- [ ] **Step 5: Commit and report the number**

Phase 2 is scoped from this commit's numbers, not from a guess. Bring Gabe the count before starting any promotion.

---

## Self-Review

**Spec coverage.** §1 findings → the Task 8/9 migrations and seeds. §2 definition → sweep Step B. §3 declaration format → Tasks 1–2 (namespace derivation, parser, `.css` scanning). §4 generator and hard errors → Task 3 (all eight rules, one test each) and Task 6. §5 ratchet → Task 6 with a red check. §6 honest limit → Task 5 (preamble text asserted by test) and Task 7 (the lint, at its true rung). §7 phasing and sweep order → Tasks 9–19 in exactly the spec's order. §8 testing table → every row appears as a named test. §9 continuous review deferred → correctly absent from this plan.

**Placeholder scan.** No TBD/TODO. The sweep tasks carry real seeds and a full procedure rather than "declare the invariants"; their variable part — which invariants exist — is exactly what the sweep is for, and Step E tells the engineer what to do when a seed turns out false. Task 20's numbers are deliberately measured rather than predicted.

**Type consistency.** `RawDeclaration` (Task 2) is consumed unchanged by `checkAll` (Task 3) and `scanTree` (Task 4). `Declaration` and `MIN_RUNG` flow from Task 3 into Tasks 5 and 6. `Problem` is defined once in `check.ts` and reused by `redFlags.ts` (Task 7). `buildRegister`'s return shape is fixed in Task 6 and used unchanged by the three gate tests. `repoRoot` is exported from `scan.ts` (Task 4) and imported by `cli.ts` and both gate test files.

**One fix applied inline:** Task 7's `SKIP` set adds `"test"`, which Task 4's does not — the red-flag lint must not fire on test fixtures that deliberately contain the phrases, while the scanner must still find declarations in test files if any are ever written there. Intentional difference, noted here so it is not read as a copy error.
