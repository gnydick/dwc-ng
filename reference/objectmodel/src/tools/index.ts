import ModelObject from "../ModelObject";

import ToolRetraction from "./ToolRetraction";

export enum ToolState {
    off = "off",
    active = "active",
    standby = "standby"
}

export class Tool extends ModelObject {
    active: Array<number> = [];
    axes: Array<Array<number>> = [];
    extruders: Array<number> = [];
    fans: Array<number> = [];
    /** @deprecated Use feedForwardPwm instead */
    feedForward: Array<number> = [];
    feedForwardAdvance: number = 0;
    feedForwardPwm: Array<number> = [];
    feedForwardTemp: Array<number> = [];
    filamentExtruder: number = -1;
    heaters: Array<number> = [];
    isRetracted: boolean = false;
    mix: Array<number> = [];
    name: string = "";
    number: number = 0;
    offsets: Array<number> = [];
    offsetsProbed: boolean = false;
    retraction: ToolRetraction = new ToolRetraction();
    spindle: number = -1;
    spindleRpm: number = 0;
    standby: Array<number> = [];
    state: ToolState = ToolState.off;
}

export default Tool
