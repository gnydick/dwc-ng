import ModelCollection, { initCollection } from "../../ModelCollection";
import ModelObject, { IModelObject } from "../../ModelObject";
import KinematicsBase from "./KinematicsBase";
import { getKinematics } from "./index";

export class DeltaTower extends ModelObject {
    angleCorrection: number = 0;
    diagonal: number = 0;
    endstopAdjustment: number = 0;
    xPos: number = 0;
    yPos: number = 0;
}

export class DeltaKinematics extends KinematicsBase {
    deltaRadius: number = 0;
    homedHeight: number = 0;
    printRadius: number = 0;
    readonly towers: ModelCollection<DeltaTower> = initCollection(DeltaTower, [{}, {}, {}]);
    xTilt: number = 0;
    yTilt: number = 0;

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

export default DeltaKinematics
