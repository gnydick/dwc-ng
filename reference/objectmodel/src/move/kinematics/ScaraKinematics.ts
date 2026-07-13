import { IModelObject } from "../../ModelObject";
import { ZLeadscrewKinematics } from "./KinematicsBase";
import { getKinematics } from "./index";

export class ScaraKinematics extends ZLeadscrewKinematics {
    crosstalk: number[] = [0, 0, 0];
    distalLength: number = 0;
    minRadius: number = 0;
    proximalLength: number = 0;
    psiLimits: number[] = [0, 0];
    thetaLimits: number[] = [0, 0];
    xOffset: number = 0;
    yOffset: number = 0;

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

export default ScaraKinematics
