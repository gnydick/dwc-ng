import ModelObject from "../ModelObject";

export enum HeaterMonitorAction {
    generateFault = 0,
    permanentSwitchOff = 1,
    temporarySwitchOff = 2,
    shutDown = 3
}

export enum HeaterMonitorCondition {
    disabled = "disabled",
    tooHigh = "tooHigh",
    tooLow = "tooLow"
}

export class HeaterMonitor extends ModelObject {
    action: HeaterMonitorAction | null = null;
    condition: HeaterMonitorCondition = HeaterMonitorCondition.disabled;
    limit: number | null = null;
    sensor: number = -1;
}

export default HeaterMonitor
