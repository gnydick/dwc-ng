import { IModelObject } from "../../ModelObject";
import KinematicsBase, { KinematicsName, ZLeadscrewKinematics } from "./KinematicsBase";
import CoreKinematics from "./CoreKinematics";
import DeltaKinematics from "./DeltaKinematics";
import HangprinterKinematics from "./HangprinterKinematics";
import ScaraKinematics from "./ScaraKinematics";
import PolarKinematics from "./PolarKinematics";

export class Kinematics extends KinematicsBase {
    constructor(name: KinematicsName = KinematicsName.cartesian) {
        super(name);
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

export default Kinematics

export function getKinematics(name: KinematicsName): KinematicsBase {
    switch (name) {
        case KinematicsName.cartesian:
        case KinematicsName.coreXY:
        case KinematicsName.coreXYU:
        case KinematicsName.coreXYUV:
        case KinematicsName.coreXZ:
        case KinematicsName.markForged:
            return new CoreKinematics(name);
        case KinematicsName.delta:
            return new DeltaKinematics(name);
	    case KinematicsName.rotaryDelta:
		    return new Kinematics(name);
        case KinematicsName.hangprinter:
            return new HangprinterKinematics();
        case KinematicsName.fiveBarScara:
        case KinematicsName.scara:
            return new ScaraKinematics(name);
        case KinematicsName.polar:
            return new PolarKinematics();
        default:
            const _exhaustiveCheck: never = name;
        case KinematicsName.unknown:
            console.warn(`Kinematics '${name}' is not supported, falling back to cartesian`);
            return new CoreKinematics(name);
    }
}

export * from "./CoreKinematics";
export * from "./DeltaKinematics";
export * from "./HangprinterKinematics";
export * from "./KinematicsBase";
export * from "./PolarKinematics";
export * from "./ScaraKinematics";
