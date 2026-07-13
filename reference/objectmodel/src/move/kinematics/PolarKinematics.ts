import { IModelObject } from "../../ModelObject";
import KinematicsBase, { KinematicsName } from "./KinematicsBase";
import { getKinematics } from "./index";

export class PolarKinematics extends KinematicsBase {
    constructor() {
        super(KinematicsName.polar);
    }

    radiusHomed: number = 0;
    radiusMax: number = 0;
    radiusMin: number = 0;
    ttAccMax: number = 0;
    ttSpeedMax: number = 0;

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

export default PolarKinematics
