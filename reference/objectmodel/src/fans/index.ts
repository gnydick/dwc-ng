import ModelObject from "../ModelObject";

export class FanThermostaticControl extends ModelObject {
    heaters: Array<number> = [];                // *** deprecated as of v3.5, use sensors instead
    highTemperature: number | null = null;
    lowTemperature: number | null = null;
    sensors: Array<number> = [];
}

export class Fan extends ModelObject {
    actualValue: number = 0;
    blip: number = 0.1;
    frequency: number = 250;
    max: number = 1;
    min: number = 0;
    name: string = "";
    requestedValue: number = 0;
    rpm: number = -1;
    tachoPpr: number = 2.0;
    readonly thermostatic: FanThermostaticControl = new FanThermostaticControl();
}

export default Fan
