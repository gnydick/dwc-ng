import ModelObject from "../ModelObject";
import ModelCollection from "../ModelCollection";

import Axis from "./Axis";
import Extruder from "./Extruder";
import InputShaping from "./InputShaping";
import KeepoutZone from "./KeepoutZone";
import MoveCalibration from "./MoveCalibration";
import MoveCompensation from "./MoveCompensation";

import Kinematics, { CoreKinematics, KinematicsName } from "./kinematics";

export class CurrentMove extends ModelObject {
    acceleration: number = 0;
    deceleration: number = 0;
    extrusionRate: number = 0;
    laserPwm: number | null = null;
    requestedSpeed: number = 0;
    topSpeed: number = 0;
}

export class MotorsIdleControl extends ModelObject {
    factor: number = 0.3;
    timeout: number = 30;
}

export class MoveQueueItem extends ModelObject {
    gracePeriod: number = 0;
    length: number = 0;
}

export class MoveRotation extends ModelObject {
    angle: number = 0;
    centre: Array<number> = [0, 0];
}

export class Move extends ModelObject {
    accelerationTime: number | null = null;
    readonly axes: ModelCollection<Axis> = new ModelCollection(Axis);
    backlashFactor: number = 10;
    readonly calibration: MoveCalibration = new MoveCalibration();
    readonly compensation: MoveCompensation = new MoveCompensation();
    readonly currentMove: CurrentMove = new CurrentMove();
    readonly extruders: ModelCollection<Extruder> = new ModelCollection(Extruder);
    readonly idle: MotorsIdleControl = new MotorsIdleControl();
    readonly keepout: ModelCollection<KeepoutZone | null> = new ModelCollection(KeepoutZone);
    kinematics: Kinematics = new CoreKinematics(KinematicsName.cartesian);
    limitAxes: boolean = true;
    noMovesBeforeHoming: boolean = true;
    printingAcceleration: number = 10000;
    readonly queue: ModelCollection<MoveQueueItem> = new ModelCollection(MoveQueueItem);
    readonly rotation: MoveRotation = new MoveRotation();
    readonly shaping: InputShaping = new InputShaping();
    speedFactor: number = 1;
    travelAcceleration: number = 10000;
    usingSCurve: boolean | null = null;
    virtualEPos: number = 0;
    workplaceNumber: number = 0;
}

export default Move

export * from "./kinematics";

export * from "./Axis";
export * from "./DriverId";
export * from "./Extruder";
export * from "./InputShaping";
export * from "./KeepoutZone";
export * from "./Microstepping";
export * from "./MoveCalibration";
export * from "./MoveCompensation";
