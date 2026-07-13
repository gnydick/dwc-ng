import { IModelObject } from "../../ModelObject";
import { KinematicsName, ZLeadscrewKinematics } from "./KinematicsBase";
import { getKinematics } from "./index";

export class CoreKinematics extends ZLeadscrewKinematics {
    constructor(name: KinematicsName) {
        super(name);
    }

    forwardMatrix: Array<Array<number>> = [
        [ 1, 0, 0 ],
        [ 0, 1, 0 ],
        [ 0, 0, 1 ]
    ]
    inverseMatrix: Array<Array<number>> = [
        [ 1, 0, 0 ],
        [ 0, 1, 0 ],
        [ 0, 0, 1 ]
    ]

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

export default CoreKinematics
