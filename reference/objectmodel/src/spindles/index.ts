import ModelObject from "../ModelObject";

export enum SpindleState {
    unconfigured = "unconfigured",
    stopped = "stopped",
    forward = "forward",
    reverse = "reverse"
}

export enum SpindleType {
    enaDir = "enaDir",
    fwdRev = "fwdRev"
}

export class Spindle extends ModelObject {
    active: number | null = null;
    canReverse: boolean | null = null;
    current: number | null = null;
    frequency: number | null = null;
    idlePwm: number | null = null;
    min: number | null = null;
    minPwm: number | null = null;
    max: number | null = null;
    maxPwm: number | null = null;
    state: SpindleState = SpindleState.unconfigured;
    type: SpindleType | null = null;
}

export default Spindle
