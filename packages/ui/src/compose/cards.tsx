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
import type { JSX } from "solid-js";
import { PositionBody } from "../cards/PositionCard.tsx";
import { FilamentEditorBody } from "../cards/FilamentEditor.tsx";
import { ToolsHeatersBody } from "../cards/ToolsHeatersCard.tsx";
import { ActiveJobBody } from "../cards/ActiveJobCard.tsx";
import { SensorsBody } from "../cards/SensorsCard.tsx";
import { TemperaturesBody } from "../cards/TemperaturesCard.tsx";
import { BuildObjects } from "../cards/BuildObjects.tsx";
import {
	AtxBody, FilamentBody, HeatersBody, FansBody, TuningBody,
} from "../cards/ControlCards.tsx";
import { PinnedCommandsBody } from "../cards/PinnedCommandsCard.tsx";
import { ControlList } from "./controls/ControlList.tsx";
import { HOMING_SPEC, MOVEMENT_SPEC } from "./controls/builtin.ts";
import {
	JobFilesBody, JobDetailsBody, MacrosBody, SystemFilesBody, OmInspectorBody, MacrosEditorBody, SystemEditorBody,
} from "../cards/FileCards.tsx";
import { HeightmapBody, ProbePointBody, MeshBody, BedTramBody } from "../cards/BedCards.tsx";
import {
	AxisRolesBody, DockSensorsBody, BedProbeBody, CameraConfigBody, SensorNamesBody, SavedVersionsBody, ConfigSaveBody,
	HeaterColorsBody, ThermalColorsBody,
} from "../cards/SettingsCards.tsx";
import { FirmwareBody } from "../cards/FirmwareUpdateCard.tsx";
import { LayersBody } from "../cards/LayersCard.tsx";
import { GcodeViewerBody } from "../gcode/GcodeViewer.tsx";
import { ConsoleBody } from "../shell/ConsolePanel.tsx";
import { CameraBody, CameraHideAction } from "../shell/CameraPanel.tsx";
import type { CardId } from "./defs.ts";
import type { CardCtx } from "./ctx.ts";

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
	heaters: { body: () => <HeatersBody /> },
	movement: { body: ctx => <div class="jog-controls"><ControlList spec={MOVEMENT_SPEC} ctx={ctx} /></div> },
	fans: { body: ctx => <FansBody orientation={ctx.orientation} /> },
	"pinned-commands": { body: () => <PinnedCommandsBody /> },
	tuning: { body: () => <TuningBody /> },
	"job-files": { body: ctx => <JobFilesBody ctx={ctx} /> },
	"job-details": { body: ctx => <JobDetailsBody ctx={ctx} /> },
	macros: { body: ctx => <MacrosBody ctx={ctx} /> },
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
	"saved-versions": { body: () => <SavedVersionsBody /> },
	"config-save": { body: () => <ConfigSaveBody /> },
};

/** The per-section "Reset drops the overlay" header action Settings cards share. */
function resetAction(section: Parameters<CardCtx["config"]["resetSection"]>[0]) {
	return (ctx: CardCtx): JSX.Element => (
		<button class="link-btn" onClick={() => ctx.config.resetSection(section)}>Reset</button>
	);
}
