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
import { ToolsHeatersBody } from "../cards/ToolsHeatersCard.tsx";
import { ActiveJobBody } from "../cards/ActiveJobCard.tsx";
import { SensorsBody } from "../cards/SensorsCard.tsx";
import { TemperaturesBody } from "../cards/TemperaturesCard.tsx";
import { BuildObjects } from "../cards/BuildObjects.tsx";
import {
	HomingBody, AtxBody, ToolsBody, FilamentBody, HeatersBody, MovementBody, FansBody, TuningBody,
} from "../cards/ControlCards.tsx";
import {
	JobFilesBody, JobDetailsBody, MacrosBody, SystemFilesBody, OmInspectorBody, MacrosEditorBody, SystemEditorBody,
} from "../cards/FileCards.tsx";
import { HeightmapBody, ProbePointBody } from "../cards/BedCards.tsx";
import {
	AxisRolesBody, DockSensorsBody, BedProbeBody, CameraConfigBody, SensorNamesBody, SavedVersionsBody, ConfigSaveBody,
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
	"active-job": { body: () => <ActiveJobBody /> },
	"active-job-detailed": { body: () => <ActiveJobBody detailed /> },
	sensors: { body: ctx => <SensorsBody orientation={ctx.orientation} /> },
	temperatures: { body: () => <TemperaturesBody /> },
	console: { body: () => <ConsoleBody /> },
	camera: { body: () => <CameraBody />, actions: () => <CameraHideAction /> },
	"build-objects": { body: () => <BuildObjects /> },
	"gcode-viewer": { body: () => <GcodeViewerBody /> },
	layers: { body: () => <LayersBody /> },
	homing: { body: () => <HomingBody /> },
	atx: { body: () => <AtxBody /> },
	tools: { body: () => <ToolsBody /> },
	filament: { body: () => <FilamentBody /> },
	heaters: { body: () => <HeatersBody /> },
	movement: { body: () => <MovementBody /> },
	fans: { body: ctx => <FansBody orientation={ctx.orientation} /> },
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
	"axis-roles": { body: () => <AxisRolesBody />, actions: resetAction("axisRoles") },
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
