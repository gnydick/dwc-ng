import { IModelObject } from "../../ModelObject";
import KinematicsBase, { KinematicsName } from "./KinematicsBase";
import { getKinematics } from "./index";

export class HangprinterKinematics extends KinematicsBase {
    anchors: Array<Array<number>> = [
        [     0, -2000, -100 ],
        [  2000,  1000, -100 ],
        [ -2000,  1000, -100 ],
        [     0,     0, 3000 ]
    ]
    printRadius: number = 1500;

    constructor() {
        super(KinematicsName.hangprinter);
    }

    override update(jsonElement: any): IModelObject | null {
        if (jsonElement === null) {
            throw new Error("Kinematics must not be null");
        }

        if (typeof jsonElement.name === "string" && this.name !== jsonElement.name) {
            return getKinematics(jsonElement.name).update(jsonElement);
        }
        return super.update(jsonElement);
    }
}

export default HangprinterKinematics