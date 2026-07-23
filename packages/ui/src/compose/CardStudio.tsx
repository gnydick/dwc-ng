/**
 * The card studio (phase B2.5): the GUI editor for user-authored cards.
 *
 * Two modes over ONE spec: the form (inputs + rows of buttons — the common
 * case) and raw JSON (the full vocabulary: forEach, jog primitives, grids).
 * Form ⇄ JSON is a real round-trip via formModel.ts; a spec the form can't
 * show refuses to lift rather than approximating. Saving — from either
 * mode — serializes and passes the SAME untrusted boundary every card
 * compiles through, so the studio cannot author anything an import file
 * couldn't say.
 *
 * The live preview renders the actual ControlList against the real ctx's
 * OBJECT MODEL (so {om:…} reads resolve) but inside its own AppContext
 * whose connector reaches no machine — a preview send has no route to the
 * board by construction, wherever the studio was opened from. Pointer
 * events off and `inert` are the visual/focus half; the provider swap is
 * the enforcement.
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import { AppContext, useApp, type AppServices } from "../shell/context.ts";
import { createStubConnector } from "../connector/stubConnector.ts";
import { ControlList } from "./controls/ControlList.tsx";
import { parseControlSpecText } from "./controls/parse.ts";
import { SPINDLE_EXAMPLE, SPINDLE_EXAMPLE_NAME } from "./controls/examples.ts";
import { emptyButton, emptyForm, toSpec, tryFromSpec, type FormItem, type FormState } from "./controls/formModel.ts";
import type { CustomCardId } from "./composition.ts";
import type { CardCtx } from "./ctx.ts";

export function CardStudio(props: {
	/** null = authoring a new card. */
	cardId: CustomCardId | null;
	/** For the live preview. */
	ctx: CardCtx;
	onSaved: (id: CustomCardId | null, name: string, specJson: string) => void;
	onClose: () => void;
}) {
	const app = useApp();
	const existing = props.cardId !== null ? app.config.config.cards[props.cardId] : undefined;

	// The preview's world: the surrounding om/config/temps (live values render
	// exactly as they will on a screen) but a connector that reaches nothing.
	const previewServices: AppServices = {
		om: props.ctx.om,
		config: props.ctx.config,
		temps: props.ctx.temps,
		connector: createStubConnector(() => undefined),
	};

	const initialForm = ((): { form: FormState; json: string; mode: "form" | "json" } => {
		if (existing === undefined) return { form: emptyForm(), json: "", mode: "form" };
		const parsed = parseControlSpecText(existing.spec);
		const lifted = parsed.ok ? tryFromSpec(parsed.data) : null;
		return lifted !== null
			? { form: lifted, json: existing.spec, mode: "form" }
			: { form: emptyForm(), json: existing.spec, mode: "json" };
	})();

	const [name, setName] = createSignal(existing?.name ?? "");
	const [mode, setMode] = createSignal<"form" | "json">(initialForm.mode);
	const [form, setForm] = createStore<FormState>(initialForm.form);
	const [json, setJson] = createSignal(initialForm.json);
	const [error, setError] = createSignal("");

	const currentJson = (): string =>
		mode() === "json" ? json() : JSON.stringify(toSpec(unwrap(form) as FormState), null, 2);

	/** Patch one button row item — typed narrowing instead of path-setter
	 *  casts (the union item type defeats Solid's typed paths). */
	const patchButton = (row: number, item: number, patch: Partial<Extract<FormItem, { kind: "button" }>>): void => {
		setForm("rows", row, "items", item, produce(it => {
			if (it.kind === "button") Object.assign(it, patch);
		}));
	};

	/** Live preview through the one boundary — errors render as themselves. */
	const preview = createMemo(() => parseControlSpecText(currentJson()));

	const switchMode = (): void => {
		setError("");
		if (mode() === "form") {
			setJson(currentJson());
			setMode("json");
			return;
		}
		const parsed = parseControlSpecText(json());
		if (!parsed.ok) {
			setError(parsed.error);
			return;
		}
		const lifted = tryFromSpec(parsed.data);
		if (lifted === null) {
			setError("This spec uses features the form can't show (forEach / grid / jog / classes) — keep editing as JSON.");
			return;
		}
		setForm(lifted);
		setMode("form");
	};

	const insertExample = (): void => {
		setError("");
		if (name().trim() === "") setName(SPINDLE_EXAMPLE_NAME);
		const lifted = tryFromSpec(SPINDLE_EXAMPLE);
		if (mode() === "form" && lifted !== null) setForm(lifted);
		else {
			setMode("json");
			setJson(JSON.stringify(SPINDLE_EXAMPLE, null, 2));
		}
	};

	const save = (): void => {
		const trimmed = name().trim();
		if (trimmed === "") {
			setError("The card needs a name.");
			return;
		}
		const text = currentJson();
		const parsed = parseControlSpecText(text);
		if (!parsed.ok) {
			setError(parsed.error);
			return;
		}
		props.onSaved(props.cardId, trimmed, text);
	};

	return (
		<div class="studio-backdrop" onClick={e => { if (e.target === e.currentTarget) props.onClose(); }}>
			<div class="studio" role="dialog" aria-label="Card studio">
				<div class="studio-head">
					<input
						class="fb-input studio-name"
						placeholder="Card name"
						value={name()}
						onInput={e => setName(e.currentTarget.value)}
					/>
					<button class="fb-act" onClick={insertExample} title="Insert a working spindle-control example (M3/M4/M5)">Insert example</button>
					<button class="fb-act" aria-pressed={mode() === "json"} onClick={switchMode}>
						{mode() === "form" ? "Edit as JSON" : "Edit as form"}
					</button>
				</div>

				<div class="studio-body">
					<div class="studio-edit">
						<Show
							when={mode() === "form"}
							fallback={
								<textarea
									class="compose-json studio-json"
									spellcheck={false}
									value={json()}
									onInput={e => { setJson(e.currentTarget.value); setError(""); }}
								/>
							}
						>
							{/* ---- inputs ---- */}
							<div class="studio-sect">
								<span class="lab-cap">Inputs</span>
								<button class="link-btn" onClick={() => setForm("inputs", produce(list => { list.push({ name: `in${list.length + 1}`, kind: "number", label: "", default: 0, options: [], unit: "" }); }))}>+ input</button>
							</div>
							<For each={form.inputs}>
								{(input, i) => (
									<div class="studio-inputrow">
										<input class="fb-input st-name" placeholder="name" value={input.name}
											onInput={e => setForm("inputs", i(), "name", e.currentTarget.value)} />
										<select class="fb-input st-kind" value={input.kind}
											onChange={e => setForm("inputs", i(), "kind", e.currentTarget.value as "number" | "chips")}>
											<option value="number">number</option>
											<option value="chips">chips</option>
										</select>
										<input class="fb-input st-label" placeholder="label" value={input.label}
											onInput={e => setForm("inputs", i(), "label", e.currentTarget.value)} />
										<input class="fb-input st-default" type="number" title="default" value={input.default}
											onInput={e => setForm("inputs", i(), "default", Number(e.currentTarget.value))} />
										<Show when={input.kind === "chips"}>
											<input class="fb-input st-options" placeholder="10, 50, 100" title="chip values"
												value={input.options.join(", ")}
												onChange={e => setForm("inputs", i(), "options",
													e.currentTarget.value.split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n)))} />
										</Show>
										<input class="fb-input st-unit" placeholder="unit" value={input.unit}
											onInput={e => setForm("inputs", i(), "unit", e.currentTarget.value)} />
										<button class="link-btn" title="Remove input"
											onClick={() => setForm("inputs", produce(list => { list.splice(i(), 1); }))}>✕</button>
									</div>
								)}
							</For>

							{/* ---- rows of controls ---- */}
							<div class="studio-sect">
								<span class="lab-cap">Controls</span>
								<button class="link-btn" onClick={() => setForm("rows", produce(rows => { rows.push({ label: "", items: [] }); }))}>+ row</button>
							</div>
							<For each={form.rows}>
								{(row, r) => (
									<div class="studio-row">
										<div class="studio-rowhead">
											<input class="fb-input st-rowlabel" placeholder="row label (optional)" value={row.label}
												onInput={e => setForm("rows", r(), "label", e.currentTarget.value)} />
											<button class="link-btn" onClick={() => setForm("rows", r(), "items", produce(items => { items.push(emptyButton()); }))}>+ button</button>
											<Show when={form.inputs.length > 0}>
												<select
													class="fb-input st-addinput"
													value=""
													onChange={e => {
														const v = e.currentTarget.value;
														if (v !== "") setForm("rows", r(), "items", produce(items => { items.push({ kind: "input", name: v }); }));
														e.currentTarget.value = "";
													}}
												>
													<option value="">+ input…</option>
													<For each={form.inputs}>{input => <option value={input.name}>{input.name}</option>}</For>
												</select>
											</Show>
											<button class="link-btn" title="Remove row"
												onClick={() => setForm("rows", produce(rows => { rows.splice(r(), 1); }))}>✕</button>
										</div>
										<For each={row.items}>
											{(item, i) => (
												<Show
													when={item.kind === "button" ? item : null}
													fallback={
														<div class="studio-itemrow st-inputref">
															<span class="lab-cap">input</span>
															<span class="st-refname">{(item as { name: string }).name}</span>
															<button class="link-btn" onClick={() => setForm("rows", r(), "items", produce(items => { items.splice(i(), 1); }))}>✕</button>
														</div>
													}
												>
													{btn => (
														<div class="studio-itemrow">
															<input class="fb-input st-btnlabel" placeholder="label" value={btn().label}
																onInput={e => patchButton(r(), i(), { label: e.currentTarget.value })} />
															<input class="fb-input st-template mono" placeholder='G-code, e.g. M3 S{input.rpm}' value={btn().template}
																onInput={e => patchButton(r(), i(), { template: e.currentTarget.value })} />
															<select class="fb-input st-variant" value={btn().variant}
																onChange={e => patchButton(r(), i(), { variant: e.currentTarget.value as "" | "go" | "danger" | "quiet" })}>
																<option value="">plain</option>
																<option value="go">go</option>
																<option value="danger">danger</option>
																<option value="quiet">quiet</option>
															</select>
															<label class="check st-stamp" title="Show the mono G-code stamp on the button">
																<input type="checkbox" checked={btn().stamp}
																	onChange={e => patchButton(r(), i(), { stamp: e.currentTarget.checked })} />
																stamp
															</label>
															<button class="link-btn" onClick={() => setForm("rows", r(), "items", produce(items => { items.splice(i(), 1); }))}>✕</button>
														</div>
													)}
												</Show>
											)}
										</For>
									</div>
								)}
							</For>
						</Show>
					</div>

					{/* ---- live preview: real renderer, no route to the machine ---- */}
					<div class="studio-preview">
						<span class="lab-cap">Preview — controls inert</span>
						{/* inert removes the preview from the tab order too —
						    pointer-events:none alone left Tab+Enter reachable. */}
						<div class="studio-preview-card card" inert>
							<AppContext.Provider value={previewServices}>
								<Show
									when={(() => { const p = preview(); return p.ok ? p.spec : null; })()}
									fallback={<p class="job-empty">{(() => { const p = preview(); return p.ok ? "" : p.error; })()}</p>}
									keyed
								>
									{spec => <ControlList spec={spec} ctx={props.ctx} />}
								</Show>
							</AppContext.Provider>
						</div>
					</div>
				</div>

				{/* Reserved line: an error appearing must not shove the buttons. */}
				<p class="fb-msg" classList={{ show: error() !== "" }}>{error() || " "}</p>
				<div class="compose-row">
					<button class="fb-act ok" onClick={save}>{props.cardId === null ? "Create card" : "Save card"}</button>
					<button class="fb-act" onClick={props.onClose}>Cancel</button>
				</div>
			</div>
		</div>
	);
}
