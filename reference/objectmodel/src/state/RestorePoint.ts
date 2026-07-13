import ModelObject from "../ModelObject";

export class RestorePoint extends ModelObject {
    coords: Array<number> = [];
    extruderPos: number = 0;
    fanPwm: number = 0;
    feedRate: number = 0;
    ioBits: number | null = null;
    laserPwm: number | null = null;
    toolNumber: number = -1;
}

export default RestorePoint
