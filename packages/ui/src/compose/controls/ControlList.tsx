/**
 * The control renderer — the sole route from a compiled control spec to the
 * screen (rung 7). Every button it produces is a GcodeButton, so every
 * data-defined control wears its LIVE-resolved G-code (I15) and sends only
 * through the guarded connector in ctx (I16). Motion primitives (jog-pad,
 * axis-jog) do not take templates: they emit through control/commands.ts —
 * cmd.jog stays the single authority for jog G-code, data only picks axes
 * and binds the step/feed inputs.
 */
import { For, Show, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { createStore } from "solid-js/store";
import { GcodeButton } from "../../control/GcodeButton.tsx";
import { cmd } from "../../control/commands.ts";
import { createRangeGesture } from "../../control/rangeGesture.ts";
import { useApp } from "../../shell/context.ts";
import { readOm, readOmList } from "./omSelector.ts";
import { formatReadoutValue } from "./readout.ts";
import { resolveTemplate, type TemplateScope } from "./template.ts";
import { isInputRef, type CompiledControlSpec, type CompiledNode, type CompiledRowItem, type EnrichmentId } from "./spec.ts";
import type { CardCtx } from "../ctx.ts";
import { unreachable } from "../../util/unreachable.ts";

/** Closed enrichment registry (data names one; code defines it — rung 8). */
const ENRICHMENTS: Record<EnrichmentId, (item: Record<string, unknown>, ctx: CardCtx) => Record<string, unknown>> = {
	/** move.axes items gain `label`: the letter plus the user's role name. */
	axisLabel: (item, ctx) => {
		const letter = String(item.letter ?? "");
		const role = ctx.config.config.axisRoles[letter];
		// `role` is exposed separately from `label` so a caller can put the
		// letter and the role in DIFFERENT slots — the homing table sets them
		// as a row's label and sub, which a single pre-joined string cannot do.
		// Empty (not undefined) when unset, so a template resolves it to "".
		return { ...item, label: role ? `${letter} · ${role}` : letter, role: role ?? "" };
	},
};

export function ControlList(props: { spec: CompiledControlSpec; ctx: CardCtx }) {
	// The send route for the slider — the SAME guarded connector GcodeButton
	// resolves, so the Card Studio preview's provider swap (stub connector)
	// covers a previewed slider exactly as it covers a previewed button.
	const app = useApp();
	// Shared live inputs (step sizes, feeds) — card-local state, seeded from
	// the spec's defaults, consumed by templates and the motion primitives.
	const [inputs, setInputs] = createStore<Record<string, number>>(
		Object.fromEntries(Object.entries(props.spec.inputs).map(([name, def]) => [name, def.default])),
	);

	const scopeWith = (vars: Record<string, unknown>): TemplateScope => ({
		input: name => inputs[name],
		om: props.ctx.om.om,
		vars,
	});

	const InputControl = (p: { name: string }): JSX.Element => {
		const def = props.spec.inputs[p.name]!;
		return (
			<Show
				when={def.kind === "chips"}
				fallback={
					<label class="feed-field">
						{def.label}
						<input
							type="number"
							value={inputs[p.name]}
							onInput={e => setInputs(p.name, Number(e.currentTarget.value))}
						/>
					</label>
				}
			>
				<For each={def.options ?? []}>
					{opt => (
						<button
							class="chip-btn"
							classList={{ active: inputs[p.name] === opt }}
							onClick={() => setInputs(p.name, opt)}
						>
							{opt}{def.unit ? ` ${def.unit}` : ""}
						</button>
					)}
				</For>
			</Show>
		);
	};

	const RenderNode = (p: { node: CompiledNode; vars: Record<string, unknown> }): JSX.Element => {
		const node = p.node;
		switch (node.type) {
			case "gcode-button":
				return (
					<GcodeButton
						label={resolveTemplate(node.label, scopeWith(p.vars))}
						command={resolveTemplate(node.template, scopeWith(p.vars))}
						variant={node.variant}
						stamp={node.stamp}
						class={node.class}
						ariaLabel={node.aria === undefined ? undefined : resolveTemplate(node.aria, scopeWith(p.vars))}
					/>
				);
			case "jog-pad": {
				const has = (letter: string): boolean =>
					props.ctx.om.om.move.axes.some(a => a.visible && a.letter === letter);
				const step = (): number => inputs[node.step] ?? 0;
				const feed = (): number => inputs[node.feed] ?? 0;
				return (
					<div class="jog-pad">
						<Show when={has("X") && has("Y")}>
							<div class="jog-xy" role="group" aria-label="X/Y jog">
								<GcodeButton class="jog-key pos-yp" label="+Y" command={cmd.jog("Y", step(), feed())} stamp={false} />
								<GcodeButton class="jog-key pos-xn" label="−X" command={cmd.jog("X", -step(), feed())} stamp={false} />
								<span class="jog-center">{step()}<small>mm</small></span>
								<GcodeButton class="jog-key pos-xp" label="+X" command={cmd.jog("X", step(), feed())} stamp={false} />
								<GcodeButton class="jog-key pos-yn" label="−Y" command={cmd.jog("Y", -step(), feed())} stamp={false} />
							</div>
						</Show>
						<Show when={has("Z")}>
							<div class="jog-z" role="group" aria-label="Z jog">
								<GcodeButton class="jog-key" label="+Z" command={cmd.jog("Z", step(), feed())} stamp={false} />
								<span class="jog-zlabel">Z</span>
								<GcodeButton class="jog-key" label="−Z" command={cmd.jog("Z", -step(), feed())} stamp={false} />
							</div>
						</Show>
					</div>
				);
			}
			case "axis-jog": {
				const item = createMemo(() => {
					const value = p.vars[node.axisVar];
					return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
				});
				const letter = (): string => String(item().letter ?? "");
				const role = (): string | undefined => props.ctx.config.config.axisRoles[letter()];
				const step = (): number => inputs[node.step] ?? 0;
				const feed = (): number => inputs[node.feed] ?? 0;
				return (
					<div class="jog-row">
						{/* Always rendered, even with labels off — see .no-labels in app.css.
						    Removing the cell re-places every later cell one track earlier
						    and the rows rewrap. */}
						<span class="ctl-name">{letter()}<Show when={role()}>{r => <small>{r()}</small>}</Show></span>
						<GcodeButton label={`− ${step()}`} command={cmd.jog(letter(), -step(), feed())} stamp={false} />
						<GcodeButton label={`+ ${step()}`} command={cmd.jog(letter(), step(), feed())} stamp={false} />
					</div>
				);
			}
			case "readout": {
				// readOm is total and formatReadoutValue is total: absence, a
				// non-finite number, or a non-leaf value all render the reserved
				// placeholder — the box (and its unit) never changes shape.
				const text = (): string => formatReadoutValue(readOm(props.ctx.om.om, node.om), node.decimals);
				const label = (): string =>
					node.label === undefined ? "" : resolveTemplate(node.label, scopeWith(p.vars));
				return (
					<div class="ctl-readout">
						<Show when={label()}>
							<span class="ctl-name">{label()}</span>
						</Show>
						<span class="ctl-readout-value">
							{text()}
							<Show when={node.unit !== undefined}>
								<small>{node.unit}</small>
							</Show>
						</span>
					</div>
				);
			}
			case "slider": {
				const def = props.spec.inputs[node.input]!; // compile guarantees the reference
				const value = (): number => inputs[node.input] ?? node.min;
				const command = () => resolveTemplate(node.template, scopeWith(p.vars));
				// One send per completed value-change gesture: dragging (or
				// arrowing) updates the shared input — worn stamps re-resolve
				// live, nothing is sent — and the resolved template goes out once
				// when the gesture completes, via the shared rangeGesture machine
				// (keyboard events are not wired at all; only value changes open
				// a gesture, so a held arrow key settles into ONE send).
				const [state, setState] = createSignal<"idle" | "sending" | "sent" | "failed">("idle");
				const [error, setError] = createSignal("");
				let ackTimer: ReturnType<typeof setTimeout> | undefined;
				onCleanup(() => clearTimeout(ackTimer));
				const send = async (): Promise<void> => {
					clearTimeout(ackTimer);
					setState("sending");
					setError("");
					try {
						await app.connector.sendCode(command());
						setState("sent");
						ackTimer = setTimeout(() => setState("idle"), 1100);
					} catch (err) {
						// Refused (board, or the write guard). Colour only — the row's
						// geometry is fixed, so a refusal cannot move the handle.
						setState("failed");
						setError(err instanceof Error ? err.message : String(err));
					}
				};
				// One send per completed value-change gesture — the shared machine
				// (control/rangeGesture.ts) SpeedSlider drives too. The template
				// resolves from the inputs store, which every change has already
				// updated by the time the gesture completes.
				const gesture = createRangeGesture({ onSend: () => void send() });
				onCleanup(gesture.dispose);
				return (
					<div class="ctl-slider" title={command()}>
						<span class="ctl-name">{def.label}</span>
						<input
							class="ctl-range-input"
							type="range"
							min={node.min}
							max={node.max}
							step={node.step}
							value={value()}
							aria-label={def.label}
							onPointerDown={() => gesture.down(value())}
							onPointerUp={gesture.up}
							onPointerCancel={gesture.up}
							onBlur={gesture.blur}
							onInput={e => {
								const next = Number(e.currentTarget.value);
								const prev = value();
								setInputs(node.input, next);
								gesture.change(prev, next);
							}}
						/>
						{/* Tabular figures, reserved width: the value changes during a
						    drag and must not shove the track under the finger. */}
						<span
							class="ctl-slider-value"
							classList={{ "is-sent": state() === "sent", "is-failed": state() === "failed" }}
						>
							{value()}
							<Show when={def.unit !== undefined}>
								<small>{def.unit}</small>
							</Show>
						</span>
						<Show when={node.stamp !== false}>
							{/* The slider wears its LIVE-resolved command (I15): what a
							    release will send is on screen before it is sent. */}
							<span class="ctl-slider-cmd">{command()}</span>
						</Show>
						{/* Always present so a refusal cannot reflow the row. */}
						<span class="ctl-slider-error" classList={{ show: error() !== "" }} title={error()}>
							{error() === "" ? " " : "refused"}
						</span>
					</div>
				);
			}
			case "row": {
				// Resolved, not read: a row inside a forEach names its own item
				// ("{axis.letter}"). Gating <Show> on the RESOLVED text keeps an
				// empty result — an axis with no role — from rendering an empty
				// <small> that would still occupy its slot.
				const rowLabel = (): string =>
					node.label === undefined ? "" : resolveTemplate(node.label, scopeWith(p.vars));
				const rowSub = (): string =>
					node.sub === undefined ? "" : resolveTemplate(node.sub, scopeWith(p.vars));
				return (
					<div class={node.class ?? "ctl-wrap"}>
						<Show when={rowLabel()}>
							<span class="ctl-name">{rowLabel()}<Show when={rowSub()}>{s => <small>{s()}</small>}</Show></span>
						</Show>
						<For each={node.items}>
							{item => <RenderRowItem item={item} vars={p.vars} />}
						</For>
					</div>
				);
			}
			case "grid":
				return (
					<div class="ctl-grid">
						<For each={node.items}>
							{child => <RenderNode node={child} vars={p.vars} />}
						</For>
					</div>
				);
			case "forEach": {
				const items = createMemo(() => {
					let list = readOmList(props.ctx.om.om, node.from) as Array<Record<string, unknown>>;
					if (node.except !== undefined) {
						const { prop, values } = node.except;
						list = list.filter(item => !values.includes(String(item?.[prop])));
					}
					if (node.enrich !== undefined) {
						const enrich = ENRICHMENTS[node.enrich];
						list = list.map(item => enrich(item, props.ctx));
					}
					return list;
				});
				return (
					<For each={items()}>
						{item => <RenderNode node={node.node} vars={{ ...p.vars, [node.as]: item }} />}
					</For>
				);
			}
		}
		// Totality weld: JSX.Element admits undefined, so without this a new
		// CompiledNode variant would render as NOTHING and compile fine. This
		// makes the missing case a compile error instead.
		unreachable(node);
	};

	const RenderRowItem = (p: { item: CompiledRowItem; vars: Record<string, unknown> }): JSX.Element => (
		<Show when={isInputRef(p.item) ? p.item : null} fallback={<RenderNode node={p.item as CompiledNode} vars={p.vars} />}>
			{ref => <InputControl name={ref().input} />}
		</Show>
	);

	return (
		<For each={props.spec.nodes}>
			{node => <RenderNode node={node} vars={{}} />}
		</For>
	);
}
