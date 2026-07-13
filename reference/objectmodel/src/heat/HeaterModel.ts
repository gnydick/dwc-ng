import ModelObject from "../ModelObject";

export class HeaterModelPID extends ModelObject {
    d: number = 0;
    i: number = 0;
    overridden: boolean = false;
    p: number = 0;
    used: boolean = true;
}

export class HeaterModel extends ModelObject {
    coolingExp: number = 1.35;
    coolingRate: number = 0.56;
    deadTime: number = 5.5;
    enabled: boolean = false;
    fanCoolingRate: number = 0.56;
    heatingRate: number = 2.43;
    inverted: boolean = false;
    maxPwm: number = 1;
    readonly pid: HeaterModelPID = new HeaterModelPID();
    standardVoltage: number = 0;
}

export default HeaterModel
