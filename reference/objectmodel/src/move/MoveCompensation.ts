import ModelObject from "../ModelObject";
import { MoveDeviations } from "./MoveCalibration";

export class ProbeGrid extends ModelObject {
    axes: Array<string> = [ 'X', 'Y' ];
    maxs: Array<number> = [ -1, -1 ];
    mins: Array<number> = [ 0, 0 ];
    radius: number = 0;
    spacings: Array<number> = [ 0, 0 ];
}

export class Skew extends ModelObject {
    compensateXY: boolean = true;
    tanXY: number = 0;
    tanXZ: number = 0;
    tanYZ: number = 0;
}

export enum MoveCompensationType {
    none = "none",
    mesh = "mesh"
}

export class MoveCompensation extends ModelObject {
    constructor() {
        super();
        ModelObject.wrapModelProperty(this, "liveGrid", ProbeGrid);
        ModelObject.wrapModelProperty(this, "meshDeviation", MoveDeviations);
    }
    fadeHeight: number | null = null;
    file: string | null = null;
    liveGrid: ProbeGrid | null = null;
    meshDeviation: MoveDeviations | null = null;
    readonly probeGrid: ProbeGrid = new ProbeGrid();
    readonly skew: Skew = new Skew();
    type: MoveCompensationType = MoveCompensationType.none;
}

export default MoveCompensation
