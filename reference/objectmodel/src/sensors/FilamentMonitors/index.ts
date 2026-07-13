import { IModelObject } from "../../ModelObject";

import FilamentMonitorBase, { FilamentMonitorType } from "./FilamentMonitorBase";
import LaserFilamentMonitor from "./LaserFilamentMonitor";
import PulsedFilamentMonitor from "./PulsedFilamentMonitor";
import RotatingMagnetFilamentMonitor from "./RotatingMagnetFilamentMonitor";

export class FilamentMonitor extends FilamentMonitorBase {
    override update(jsonElement: any): IModelObject | null {
        if (jsonElement === null) {
            return null;
        }

        if (typeof jsonElement.type === "string" && jsonElement.type !== this.type) {
            return getFilamentMonitor(jsonElement.type).update(jsonElement);
        }
        return super.update(jsonElement);
    }
}

export default FilamentMonitor

export function getFilamentMonitor(type: FilamentMonitorType): FilamentMonitorBase {
    switch (type) {
        case FilamentMonitorType.laser:
            return new LaserFilamentMonitor();
        case FilamentMonitorType.pulsed:
            return new PulsedFilamentMonitor();
        case FilamentMonitorType.rotatingMagnet:
            return new RotatingMagnetFilamentMonitor();
        default:
            return new FilamentMonitor(type);
    }
}

export * from "./FilamentMonitorBase";
export * from "./Duet3DFilamentMonitor";
export * from "./LaserFilamentMonitor";
export * from "./PulsedFilamentMonitor";
export * from "./RotatingMagnetFilamentMonitor";
