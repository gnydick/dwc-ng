import ModelObject from "../ModelObject";

export enum ProbeType {
    none = 0,
    analog = 1,
    dumbModulated = 2,
    alternateAnalog = 3,
    endstopSwitch_obsolete = 4,
    digital = 5,
    e1Switch_obsolete = 6,
    zSwitch_obsolete = 7,
    unfilteredDigital = 8,
    blTouch = 9,
    zMotorStall = 10,
    scanningAnalog = 11
}

export class ProbeTouchMode extends ModelObject {
    active: boolean = false;
    sensitivity: number = 0;
    triggerHeight: number = 0;
    threshold: number = 0;
}

export class Probe extends ModelObject {
    constructor() {
        super();
        ModelObject.wrapModelProperty(this, "touchMode", ProbeTouchMode);
    }

    calibA: number | null = null;
    calibB: number | null = null;
    calibrationTemperature: number = 0;
    deployedByUser: boolean = false;
    disablesHeaters: boolean = false;

    /**
     * @deprecated use diveHeights[0] instead
     */
    diveHeight: number = 5;

    diveHeights: Array<number> = [0, 0];
    isCalibrated: boolean | null = null;
    lastStopHeight: number = 0;
    maxProbeCount: number = 1;
    measuredHeight: number | null = null;
    offsets: Array<number> = [0, 0];
    recoveryTime: number = 0;
    scanCoefficients: Array<number> | null = null;
    speeds: Array<number> = [2, 2];
    temperatureCoefficients: Array<number> = [0, 0];
    threshold: number = 500;
    tolerance: number = 0.03;
    touchMode: ProbeTouchMode | null = null;
    travelSpeed: number = 6000;
    triggerHeight: number = 0.7;
    type: ProbeType = ProbeType.none;
    value: Array<number> = [];
}

export default Probe
