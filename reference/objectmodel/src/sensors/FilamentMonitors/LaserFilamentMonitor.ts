import ModelObject, { IModelObject } from "../../ModelObject";
import { FilamentMonitorType } from "./FilamentMonitorBase";
import { Duet3DFilamentMonitor } from "./Duet3DFilamentMonitor";
import { getFilamentMonitor } from "./index";

export class LaserFilamentMonitorCalibrated extends ModelObject {
    percentMax: number = 0;
    percentMin: number = 0;
    sensivity: number = 0;
    totalDistance: number = 0;
}

export class LaserFilamentMonitorConfigured extends ModelObject {
    allMoves: boolean = false;
    calibrationFactor: number = 0;
    percentMax: number = 0;
    percentMin: number = 0;
    sampleDistance: number = 0;
}

export class LaserFilamentMonitor extends Duet3DFilamentMonitor {
    constructor() {
        super(FilamentMonitorType.laser);
        ModelObject.wrapModelProperty(this, "calibrated", LaserFilamentMonitorCalibrated);
    }

    calibrated: LaserFilamentMonitorCalibrated | null = new LaserFilamentMonitorCalibrated();
    readonly configured: LaserFilamentMonitorConfigured = new LaserFilamentMonitorConfigured();

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

export default LaserFilamentMonitor
