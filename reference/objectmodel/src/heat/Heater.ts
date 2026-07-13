import ModelCollection from "../ModelCollection";
import HeaterModel from "./HeaterModel";
import ModelObject from "../ModelObject";
import HeaterMonitor from "./HeaterMonitor";

export enum HeaterState {
    off = "off",
    standby = "standby",
    active = "active",
    fault = "fault",
    tuning = "tuning",
    offline = "offline"
}

export class Heater extends ModelObject {
    active: number = 0;
    avgPwm: number = 0;
    current: number = -273.15;
    extrPwmBoost: number | null = null;
    extrTempBoost: number | null = null;
    max: number = 285;
    maxBadReadings: number = 3;
    maxHeatingFaultTime: number = 5;
    maxTempExcursion: number = 15;
    min: number = -10;
    readonly model: HeaterModel = new HeaterModel();
    readonly monitors: ModelCollection<HeaterMonitor> = new ModelCollection(HeaterMonitor);
    sensor: number = -1;
    standby: number = 0;
    state: HeaterState = HeaterState.off;
}

export default Heater
