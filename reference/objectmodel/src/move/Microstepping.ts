import ModelObject from "../ModelObject";

export class Microstepping extends ModelObject {
    interpolated: boolean = false;
    value: number = 16;
}

export default Microstepping
