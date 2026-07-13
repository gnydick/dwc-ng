import ModelObject, { IModelObject } from "../../ModelObject";
import { FilamentMonitorType } from "./FilamentMonitorBase";
import { Duet3DFilamentMonitor } from "./Duet3DFilamentMonitor";
import { getFilamentMonitor } from "./index";

export class RotatingMagnetFilamentMonitorCalibrated extends ModelObject {
    mmPerRev: number = 0;
    percentMax: number = 0;
    percentMin: number = 0;
    totalDistance: number = 0;
}

export class RotatingMagnetFilamentMonitorConfigured extends ModelObject {
    allMoves: boolean = false;
    mmPerRev: number = 0;
    percentMax: number = 0;
    percentMin: number = 0;
    sampleDistance: number = 0;
}

export class RotatingMagnetFilamentMonitor extends Duet3DFilamentMonitor {
    constructor() {
        super(FilamentMonitorType.rotatingMagnet);
        ModelObject.wrapModelProperty(this, "calibrated", RotatingMagnetFilamentMonitorCalibrated);
    }

    calibrated: RotatingMagnetFilamentMonitorCalibrated | null = new RotatingMagnetFilamentMonitorCalibrated();
    readonly configured: RotatingMagnetFilamentMonitorConfigured = new RotatingMagnetFilamentMonitorConfigured();

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

export default RotatingMagnetFilamentMonitor
