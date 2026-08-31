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
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { AppContext, useApp, type AppServices } from "../shell/context.ts";
import { createArmed } from "../control/armed.ts";
import { planCardDelete, type CardDeletePlan } from "./screens.ts";
import { createStubConnector } from "@dwc-ng/connector";
import { ControlList } from "./controls/ControlList.tsx";
import { parseControlSpecText } from "./controls/parse.ts";
import { SPINDLE_EXAMPLE, SPINDLE_EXAMPLE_NAME } from "./controls/examples.ts";
import { emptyButton, emptyForm, emptyReadout, emptySlider, emptySpacer, emptyToggle, toSpec, tryFromSpec, type FormItem, type FormState } from "./controls/formModel.ts";
import type { CustomCardId } from "./composition.ts";
import type { CardCtx } from "./ctx.ts";

/**
 * What a save says about the card's chrome metadata (#194 inc 4, spec §7):
 * shaped exactly like updateCustomCard's metadata patch — a value sets the
 * field, null clears it back to the default its absence means. Metadata is
 * card CHROME, not spec content: it never rides the spec JSON (so it cannot
 * make a form-refusing spec lift) and it is validated only at the one gate
 * (config/types.ts sanitizeCardMeta), which both store doors already run —
 * the studio does not re-validate, the formModel.ts rule.
 */
export interface CardMetaPatch {
	colSpan: number | null;
	rowSpan: number | null;
	tip: string | null;
	padding: number | null;
}

export function CardStudio(props: {
	/** null = authoring a new card. */
	cardId: CustomCardId | null;
	/** For the live preview. */
	ctx: CardCtx;
	onSaved: (id: CustomCardId | null, name: string, specJson: string, meta: CardMetaPatch) => void;
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
		backend: app.backend,
		machineId: props.ctx.machineId,
		configLoaded: props.ctx.configLoaded,
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
	// Chrome metadata, as the text of its fields ("" = absent → null = clear).
	// Kept OUTSIDE the form/JSON mode switch: metadata is not spec content, so
	// it is editable whichever mode the spec is in.
	const [metaColSpan, setMetaColSpan] = createSignal(existing?.colSpan?.toString() ?? "");
	const [metaRowSpan, setMetaRowSpan] = createSignal(existing?.rowSpan?.toString() ?? "");
	const [metaTip, setMetaTip] = createSignal(existing?.tip ?? "");
	const [metaPadding, setMetaPadding] = createSignal(existing?.padding?.toString() ?? "");
	const [mode, setMode] = createSignal<"form" | "json">(initialForm.mode);
	const [form, setForm] = createStore<FormState>(initialForm.form);
	const [json, setJson] = createSignal(initialForm.json);
	const [error, setError] = createSignal("");

	// toSpec reads through the store PROXY (not unwrap) on purpose: the
	// preview memo below tracks those reads, so every form edit re-resolves
	// the preview. unwrap() here made form-mode edits invisible to the
	// preview — it only refreshed on a mode switch (found in the audit's
	// live verification).
	const currentJson = (): string =>
		mode() === "json" ? json() : JSON.stringify(toSpec(form), null, 2);

	/** Patch one row item of a given kind — typed narrowing instead of
	 *  path-setter casts (the union item type defeats Solid's typed paths).
	 *  One patcher for all kinds: the kind guard is the sole discriminator. */
	const patchItem = <K extends FormItem["kind"]>(kind: K) =>
		(row: number, item: number, patch: Partial<Extract<FormItem, { kind: K }>>): void => {
			setForm("rows", row, "items", item, produce(it => {
				if (it.kind === kind) Object.assign(it, patch);
			}));
		};
	const patchButton = patchItem("button");
	const patchReadout = patchItem("readout");
	const patchSlider = patchItem("slider");
	const patchToggle = patchItem("toggle");
	const patchSpacer = patchItem("spacer");

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
			setError("This spec uses features the form can't show (forEach / grid / jog / columns / groups / justify / classes / select inputs) — keep editing as JSON.");
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
		const num = (s: string): number | null => (s.trim() === "" ? null : Number(s.trim()));
		props.onSaved(props.cardId, trimmed, text, {
			colSpan: num(metaColSpan()),
			rowSpan: num(metaRowSpan()),
			tip: metaTip().trim() === "" ? null : metaTip().trim(),
			padding: num(metaPadding()),
		});
	};

	/**
	 * Deleting a CREATION is permanent once saved, so it never rides on one
	 * click (house two-step), and it arms through createArmed so Escape is a
	 * way out here like everywhere else. The armed value IS the CardDeletePlan:
	 * arming requires producing the plan, the message line renders the plan,
	 * and the confirm deletes the plan's id — there is no armed state without
	 * a computed blast radius.
	 *
	 * @invariant one-card-delete-surface
	 * @rung 6  choke-point — this armed confirm is the only user-facing route
	 *          to removeCustomCard, and test/card-delete-surface.test.ts walks
	 *          src rejecting any new caller by file and line (allowlisted: the
	 *          store definition, and ComposedScreen's import purge — which
	 *          deletes the cards embedded in a screen being displaced, a flow
	 *          with its own confirm). Promote by moving deletion behind an
	 *          executor that accepts only a CardDeletePlan once the config
	 *          layer can name compose types without an import cycle
	 * @why a second delete surface is how the blast-radius report gets skipped:
	 *      the old drawer ✕ deleted from every screen while showing only a
	 *      tooltip warning. One surface, armed with the plan, keeps "delete"
	 *      and "here is what that does" inseparable
	 */
	const [armed, setArmed] = createArmed<CardDeletePlan>();
	const deleteCard = (): void => {
		const id = props.cardId;
		if (id === null) return;
		const plan = armed();
		if (plan === null) {
			setArmed(planCardDelete(app.config.config, id));
			return;
		}
		setArmed(null);
		app.config.removeCustomCard(plan.id);
		props.onClose();
	};

	// A press anywhere but the delete button disarms it — same dismissal the
	// drawer's armed controls use. pointerdown, not click, so a press that
	// becomes a drag still disarms; registered only while armed.
	let deleteBtn: HTMLButtonElement | undefined;
	createEffect(() => {
		if (armed() === null) return;
		const disarm = (e: PointerEvent): void => {
			if (deleteBtn !== undefined && e.target instanceof Node && deleteBtn.contains(e.target)) return;
			setArmed(null);
		};
		document.addEventListener("pointerdown", disarm, { capture: true });
		onCleanup(() => document.removeEventListener("pointerdown", disarm, { capture: true }));
	});

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

				{/* ---- card chrome: authored size, tip, padding (#194 inc 4) ----
				    Blank = the stock default (custom size 156×40, "custom card"
				    tip, house padding). Values pass the one sanitizeCardMeta gate
				    at the store — a bad field is dropped there, not re-validated
				    here. */}
				<div class="studio-inputrow">
					<span class="lab-cap">Card</span>
					<input class="fb-input st-default" type="number" min="1" placeholder="width"
						title="Default footprint width in grid cells (blank = stock 156)"
						value={metaColSpan()} onInput={e => setMetaColSpan(e.currentTarget.value)} />
					<input class="fb-input st-default" type="number" min="1" placeholder="height"
						title="Default footprint height in grid cells (blank = stock 40)"
						value={metaRowSpan()} onInput={e => setMetaRowSpan(e.currentTarget.value)} />
					<input class="fb-input st-label" placeholder="tip"
						title={'Click-to-copy tip text on the card head (blank = "custom card")'}
						value={metaTip()} onInput={e => setMetaTip(e.currentTarget.value)} />
					<input class="fb-input st-default" type="number" min="0" placeholder="padding"
						title="Uniform card-body padding in u (blank = house padding)"
						value={metaPadding()} onInput={e => setMetaPadding(e.currentTarget.value)} />
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
											<button class="link-btn" onClick={() => setForm("rows", r(), "items", produce(items => { items.push(emptyReadout()); }))}>+ readout</button>
											<button class="link-btn" onClick={() => setForm("rows", r(), "items", produce(items => { items.push(emptySlider(form.inputs[0]?.name ?? "")); }))}>+ slider</button>
											<button class="link-btn" onClick={() => setForm("rows", r(), "items", produce(items => { items.push(emptyToggle()); }))}>+ toggle</button>
											<button class="link-btn" onClick={() => setForm("rows", r(), "items", produce(items => { items.push(emptySpacer()); }))}>+ spacer</button>
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
												<Switch>
													<Match when={item.kind === "button" ? item : null}>
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
													</Match>
													<Match when={item.kind === "readout" ? item : null}>
														{ro => (
															<div class="studio-itemrow">
																<span class="lab-cap">readout</span>
																<input class="fb-input st-template mono" placeholder="OM selector, e.g. heat.heaters[1].current" value={ro().om}
																	onInput={e => patchReadout(r(), i(), { om: e.currentTarget.value })} />
																<input class="fb-input st-btnlabel" placeholder="label" value={ro().label}
																	onInput={e => patchReadout(r(), i(), { label: e.currentTarget.value })} />
																<input class="fb-input st-unit" placeholder="unit" value={ro().unit}
																	onInput={e => patchReadout(r(), i(), { unit: e.currentTarget.value })} />
																<input class="fb-input st-default" type="number" placeholder="dp" title="decimal places (blank = as reported)"
																	value={ro().decimals ?? ""}
																	onInput={e => patchReadout(r(), i(), { decimals: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })} />
																<button class="link-btn" onClick={() => setForm("rows", r(), "items", produce(items => { items.splice(i(), 1); }))}>✕</button>
															</div>
														)}
													</Match>
													<Match when={item.kind === "slider" ? item : null}>
														{sl => (
															<div class="studio-itemrow">
																<span class="lab-cap">slider</span>
																<select class="fb-input st-kind" title="bound input" value={sl().input}
																	onChange={e => patchSlider(r(), i(), { input: e.currentTarget.value })}>
																	<Show when={form.inputs.every(input => input.name !== sl().input)}>
																		<option value={sl().input}>{sl().input === "" ? "input…" : sl().input}</option>
																	</Show>
																	<For each={form.inputs}>{input => <option value={input.name}>{input.name}</option>}</For>
																</select>
																<input class="fb-input st-default" type="number" placeholder="min" title="min" value={sl().min}
																	onInput={e => patchSlider(r(), i(), { min: Number(e.currentTarget.value) })} />
																<input class="fb-input st-default" type="number" placeholder="max" title="max" value={sl().max}
																	onInput={e => patchSlider(r(), i(), { max: Number(e.currentTarget.value) })} />
																<input class="fb-input st-default" type="number" placeholder="step" title="step (blank = 1)"
																	value={sl().step ?? ""}
																	onInput={e => patchSlider(r(), i(), { step: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })} />
																<input class="fb-input st-template mono" placeholder='sent on release, e.g. M220 S{input.speed}' value={sl().template}
																	onInput={e => patchSlider(r(), i(), { template: e.currentTarget.value })} />
																<label class="check st-stamp" title="Show the mono G-code stamp beside the slider">
																	<input type="checkbox" checked={sl().stamp}
																		onChange={e => patchSlider(r(), i(), { stamp: e.currentTarget.checked })} />
																	stamp
																</label>
																<button class="link-btn" onClick={() => setForm("rows", r(), "items", produce(items => { items.splice(i(), 1); }))}>✕</button>
															</div>
														)}
													</Match>
													<Match when={item.kind === "toggle" ? item : null}>
														{tg => (
															<div class="studio-itemrow">
																<span class="lab-cap">toggle</span>
																<input class="fb-input st-template mono" placeholder="state OM selector, e.g. fans[0].requestedValue" value={tg().om}
																	onInput={e => patchToggle(r(), i(), { om: e.currentTarget.value })} />
																<input class="fb-input st-btnlabel" placeholder="label" value={tg().label}
																	onInput={e => patchToggle(r(), i(), { label: e.currentTarget.value })} />
																<input class="fb-input st-template mono" placeholder="sent while ON, e.g. M106 P0 S0" title="sent when the state reads on (turn off)" value={tg().whenOn}
																	onInput={e => patchToggle(r(), i(), { whenOn: e.currentTarget.value })} />
																<input class="fb-input st-template mono" placeholder="sent while OFF, e.g. M106 P0 S1" title="sent when the state reads off (turn on)" value={tg().whenOff}
																	onInput={e => patchToggle(r(), i(), { whenOff: e.currentTarget.value })} />
																<label class="check st-stamp" title="Show the mono G-code stamp beside the toggle">
																	<input type="checkbox" checked={tg().stamp}
																		onChange={e => patchToggle(r(), i(), { stamp: e.currentTarget.checked })} />
																	stamp
																</label>
																<button class="link-btn" onClick={() => setForm("rows", r(), "items", produce(items => { items.splice(i(), 1); }))}>✕</button>
															</div>
														)}
													</Match>
													<Match when={item.kind === "spacer" ? item : null}>
														{sp => (
															<div class="studio-itemrow">
																<span class="lab-cap">spacer</span>
																<input class="fb-input st-default" type="number" placeholder="u" title="gap in u (blank = flexible: takes the free space)"
																	value={sp().size ?? ""}
																	onInput={e => patchSpacer(r(), i(), { size: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })} />
																<button class="link-btn" onClick={() => setForm("rows", r(), "items", produce(items => { items.splice(i(), 1); }))}>✕</button>
															</div>
														)}
													</Match>
													<Match when={item.kind === "input" ? item : null}>
														{ref => (
															<div class="studio-itemrow st-inputref">
																<span class="lab-cap">input</span>
																<span class="st-refname">{ref().name}</span>
																<button class="link-btn" onClick={() => setForm("rows", r(), "items", produce(items => { items.splice(i(), 1); }))}>✕</button>
															</div>
														)}
													</Match>
												</Switch>
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

				{/* Reserved line: an error — or the armed delete's blast-radius
				    report — appearing must not shove the buttons. The armed plan
				    wins while armed: its report is what the next click acts on. */}
				<p class="fb-msg" classList={{ show: armed() !== null || error() !== "" }}>
					{armed()?.message ?? (error() || " ")}
				</p>
				<div class="compose-row">
					<button class="fb-act ok" onClick={save}>{props.cardId === null ? "Create card" : "Save card"}</button>
					<button class="fb-act" onClick={props.onClose}>Cancel</button>
					<Show when={props.cardId !== null}>
						<button
							ref={deleteBtn}
							class="fb-act danger studio-delete"
							classList={{ armed: armed() !== null }}
							onClick={deleteCard}
						>
							{armed() !== null ? "Confirm delete" : "Delete card"}
						</button>
					</Show>
				</div>
			</div>
		</div>
	);
}
