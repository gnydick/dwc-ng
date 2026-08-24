/**
 * Card renderers — the JSX half of the registry.
 *
 * `Record<CardId, …>` welds this to ./defs.ts in both directions: a def
 * without a renderer here, or a renderer for an unknown id, is a compile
 * error. Bodies are CONTENT-ONLY — ComposedScreen supplies the single <Card>
 * wrapper from the def's metadata, so panel ids and chrome cannot be
 * re-declared (or misdeclared) per body. `actions` are the card's own header
 * controls (the float-right zone), also declared here so a composed card and
 * its legacy wrapper share one implementation.
 */
import { lazy, Suspense, type JSX } from "solid-js";
import { PositionBody } from "../cards/PositionCard.tsx";
import { FilamentEditorBody } from "../cards/FilamentEditor.tsx";
import { ToolsHeatersBody } from "../cards/ToolsHeatersCard.tsx";
import { ActiveJobBody } from "../cards/ActiveJobCard.tsx";
import { SensorsBody } from "../cards/SensorsCard.tsx";
import { TemperaturesBody } from "../cards/TemperaturesCard.tsx";
import { BuildObjects } from "../cards/BuildObjects.tsx";
import {
	AtxBody, FilamentBody, FansBody, TuningBody,
} from "../cards/ControlCards.tsx";
import { PinnedCommandsBody } from "../cards/PinnedCommandsCard.tsx";
import { ControlList } from "./controls/ControlList.tsx";
import { HOMING_SPEC, MOVEMENT_SPEC } from "./controls/builtin.ts";
import {
	JobFilesBody, JobsInventoryBody, JobDetailsBody, MacrosBody, MacrosInventoryBody, SystemFilesBody, OmInspectorBody, MacrosEditorBody, SystemEditorBody,
} from "../cards/FileCards.tsx";
import { HeightmapBody, ProbePointBody, MeshBody, BedTramBody } from "../cards/BedCards.tsx";
import {
	AxisRolesBody, DockSensorsBody, BedProbeBody, CameraConfigBody, SensorNamesBody, SavedVersionsBody, ConfigSaveBody,
	HeaterColorsBody, ThermalColorsBody, ShapingBody,
} from "../cards/SettingsCards.tsx";
import { FirmwareBody } from "../cards/FirmwareUpdateCard.tsx";
import { LayersBody } from "../cards/LayersCard.tsx";
import { GcodeViewerBody } from "../gcode/GcodeViewer.tsx";
import { ConsoleBody } from "../shell/ConsolePanel.tsx";
import { CameraBody, CameraHideAction } from "../shell/CameraPanel.tsx";
import type { CardId } from "./defs.ts";
import type { CardCtx } from "./ctx.ts";

/**
 * The Shaping Lab's eight bodies, behind ONE dynamic import.
 *
 * They are the largest thing on the registry and they are reached from a single
 * screen an operator visits to tune a machine, not to run one — the exact shape
 * the eager budget (packages/deploy/eager-budget.json) exists to keep off the
 * critical path. Measured 2026-08-23: eager fell from 492,903 B to 460,314 B
 * when they moved behind this boundary — 32,589 B of a 483,328 B ceiling a cold
 * DSF load has to fit under, and the difference between 9,575 B over budget and
 * 23,014 B of headroom. The alternative offered was raising the budget for the
 * third time in one night, which is not a fix.
 *
 * ONE import specifier for all eight, deliberately. Solid's `lazy` dedupes on
 * the promise, and the bundler emits one chunk per specifier — so the eight
 * cards of a screen that is always composed together arrive in one request
 * rather than eight, which is the constraint RRF's HTTP server actually has.
 *
 * Not lazy: `settings-shaping`. It is small, and it lives on Settings, a screen
 * the operator uses constantly.
 *
 * The boundary is FENCED, not merely intended: `ShapingCards.tsx` and
 * `charts/DecayChart.tsx` are on the DYNAMIC_ONLY list in
 * `test/lazy-bundle.test.ts`, so a static import of either from anywhere under
 * src/ fails the suite. That is the same mechanism, and the same declared
 * invariant, that keeps Babylon and CodeMirror out —
 * `heavy-libraries-stay-behind-a-dynamic-import`, declared on main.tsx, which
 * is the root of the eager bundle and therefore where the claim belongs.
 */
const lazyShaping = <K extends keyof typeof import("../cards/ShapingCards.tsx")>(name: K) =>
	lazy(async () => ({ default: (await import("../cards/ShapingCards.tsx"))[name] as (props: { ctx: CardCtx }) => JSX.Element }));

const ShapingStatusBody = lazyShaping("ShapingStatusBody");
const ShapingCaptureBody = lazyShaping("ShapingCaptureBody");
const ShapingDecayBody = lazyShaping("ShapingDecayBody");
const ShapingSweepBody = lazyShaping("ShapingSweepBody");
const ShapingCandidatesBody = lazyShaping("ShapingCandidatesBody");
const ShapingCustomBody = lazyShaping("ShapingCustomBody");
const ShapingVerifyBody = lazyShaping("ShapingVerifyBody");
const ShapingApplyBody = lazyShaping("ShapingApplyBody");

/**
 * Every lazy body, warmed. Dev surfaces call this because they MEASURE cards:
 * the Card Lab's floor audit and scale sweep read a rendered body's min-content
 * height, and a body still in flight would be measured as its placeholder.
 *
 * Nothing on an operator's path needs it — the placeholder reserves the body's
 * space, so a card that resolves late changes nothing about the page.
 */
export function preloadLazyBodies(): Promise<unknown> {
	return Promise.all([
		ShapingStatusBody.preload(), ShapingCaptureBody.preload(), ShapingDecayBody.preload(),
		ShapingSweepBody.preload(), ShapingCandidatesBody.preload(), ShapingCustomBody.preload(),
		ShapingVerifyBody.preload(), ShapingApplyBody.preload(),
	]);
}

/**
 * A lazy body inside its own <Suspense>, with the body's space reserved.
 *
 * The <Card> chrome is NOT inside this — RegistryCard renders it from the def's
 * metadata before this component is even reached, so the title, the tip and the
 * header actions are there on the first frame and only the content waits. The
 * fallback fills the body box (`.card-lazy` is `flex: 1` inside .panel-body's
 * column), so nothing on the canvas moves when the chunk lands. Measured with
 * the chunk BLOCKED at the network: all eight cards report the same rect to the
 * pixel suspended as loaded. Positional stability is the rule this
 * whole screen is built to; a card that jumps when its body arrives is a defect,
 * not a loading state.
 */
function Lazy(props: { component: (p: { ctx: CardCtx }) => JSX.Element; ctx: CardCtx }): JSX.Element {
	return (
		<Suspense fallback={<div class="card-lazy" aria-busy="true" />}>
			<props.component ctx={props.ctx} />
		</Suspense>
	);
}

export interface CardRender {
	body: (ctx: CardCtx) => JSX.Element;
	/** Header controls (rendered in the card-actions zone by the wrapper). */
	actions?: (ctx: CardCtx) => JSX.Element;
}

export const CARD_RENDER: Record<CardId, CardRender> = {
	position: { body: ctx => <PositionBody orientation={ctx.orientation} /> },
	"tools-heaters": { body: ctx => <ToolsHeatersBody orientation={ctx.orientation} /> },
	"filament-editor": { body: () => <FilamentEditorBody /> },
	"active-job": { body: () => <ActiveJobBody /> },
	"active-job-detailed": { body: () => <ActiveJobBody detailed /> },
	sensors: { body: ctx => <SensorsBody orientation={ctx.orientation} /> },
	temperatures: { body: () => <TemperaturesBody /> },
	console: { body: () => <ConsoleBody /> },
	camera: { body: () => <CameraBody />, actions: () => <CameraHideAction /> },
	"build-objects": { body: () => <BuildObjects /> },
	"gcode-viewer": { body: () => <GcodeViewerBody /> },
	layers: { body: () => <LayersBody /> },
	// Homing/Movement are DATA (compose/controls/builtin.ts) rendered through
	// the control vocabulary — the phase-B dogfood.
	homing: { body: ctx => <ControlList spec={HOMING_SPEC} ctx={ctx} /> },
	atx: { body: () => <AtxBody /> },
	filament: { body: () => <FilamentBody /> },
	// Tools renders the SAME body as Tools & heaters — not a second layout that
	// agrees with it. They showed the same five tools at different row pitches
	// (36px vs 45px), in a different column order (Current second vs fifth), one
	// with column headings and one without. Sharing the body makes "identical
	// except for the columns" true by construction; the columns Tools drops are
	// the next step, and become one prop rather than a second implementation to
	// keep in step.
	heaters: { body: ctx => <ToolsHeatersBody orientation={ctx.orientation} heaterControls={false} /> },
	movement: { body: ctx => <div class="jog-controls"><ControlList spec={MOVEMENT_SPEC} ctx={ctx} /></div> },
	fans: { body: ctx => <FansBody orientation={ctx.orientation} /> },
	"pinned-commands": { body: () => <PinnedCommandsBody /> },
	tuning: { body: () => <TuningBody /> },
	"job-files": { body: ctx => <JobFilesBody ctx={ctx} /> },
	"job-details": { body: ctx => <JobDetailsBody ctx={ctx} /> },
	"jobs-inventory": { body: ctx => <JobsInventoryBody ctx={ctx} /> },
	macros: { body: ctx => <MacrosBody ctx={ctx} /> },
	"macros-inventory": { body: ctx => <MacrosInventoryBody ctx={ctx} /> },
	"macros-editor": { body: ctx => <MacrosEditorBody ctx={ctx} /> },
	"system-files": { body: ctx => <SystemFilesBody ctx={ctx} /> },
	"system-editor": { body: ctx => <SystemEditorBody ctx={ctx} /> },
	"object-model": { body: ctx => <OmInspectorBody ctx={ctx} /> },
	firmware: { body: () => <FirmwareBody /> },
	heightmap: { body: ctx => <HeightmapBody ctx={ctx} /> },
	"probe-point": { body: ctx => <ProbePointBody ctx={ctx} /> },
	mesh: { body: ctx => <MeshBody ctx={ctx} /> },
	"bed-tram": { body: () => <BedTramBody /> },
	"axis-roles": { body: () => <AxisRolesBody />, actions: resetAction("axisRoles") },
	"heater-colors": { body: () => <HeaterColorsBody />, actions: resetAction("heaterColors") },
	"thermal-colors": { body: () => <ThermalColorsBody />, actions: resetAction("thermalColors") },
	"tool-dock-sensors": { body: () => <DockSensorsBody />, actions: resetAction("dockSensors") },
	"bed-probe": { body: () => <BedProbeBody />, actions: resetAction("bed") },
	"camera-config": { body: () => <CameraConfigBody />, actions: resetAction("camera") },
	"sensor-names": { body: () => <SensorNamesBody />, actions: resetAction("sensorNames") },
	"settings-shaping": { body: ctx => <ShapingBody ctx={ctx} />, actions: resetAction("shaping") },
	// The Shaping Lab. Every body is a view of ONE service (the per-tool results
	// store and the screen's selections), so the eight cards cannot disagree
	// about which tool is being tuned — see compose/services.ts `shaping`.
	"shaping-status": {
		body: ctx => <Lazy component={ShapingStatusBody} ctx={ctx} />,
		// Re-read this tool's results file. It lives on the SD card beside
		// config.g, so the operator can put one there or edit one out from under
		// the screen — the same reason the height map carries a Reload.
		actions: ctx => <button class="link-btn" onClick={() => ctx.service("shaping").reload()}>Reload</button>,
	},
	"shaping-capture": { body: ctx => <Lazy component={ShapingCaptureBody} ctx={ctx} /> },
	"shaping-decay": { body: ctx => <Lazy component={ShapingDecayBody} ctx={ctx} /> },
	"shaping-sweep": { body: ctx => <Lazy component={ShapingSweepBody} ctx={ctx} /> },
	"shaping-candidates": { body: ctx => <Lazy component={ShapingCandidatesBody} ctx={ctx} /> },
	"shaping-custom": { body: ctx => <Lazy component={ShapingCustomBody} ctx={ctx} /> },
	"shaping-verify": { body: ctx => <Lazy component={ShapingVerifyBody} ctx={ctx} /> },
	"shaping-apply": { body: ctx => <Lazy component={ShapingApplyBody} ctx={ctx} /> },
	"saved-versions": { body: () => <SavedVersionsBody /> },
	"config-save": { body: () => <ConfigSaveBody /> },
};

/** The per-section "Reset drops the overlay" header action Settings cards share. */
function resetAction(section: Parameters<CardCtx["config"]["resetSection"]>[0]) {
	return (ctx: CardCtx): JSX.Element => (
		<button class="link-btn" onClick={() => ctx.config.resetSection(section)}>Reset</button>
	);
}
