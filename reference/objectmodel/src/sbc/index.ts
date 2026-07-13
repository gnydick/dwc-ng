import ModelObject from "../ModelObject";

import DSF from "./dsf";
import CPU from "./CPU";
import Memory from "./Memory";

export class SBC extends ModelObject {
    appArmor: boolean = false;
    readonly cpu: CPU = new CPU();
    readonly dsf: DSF = new DSF();
    distribution: string | null = null;
    distributionBuildTime: string | null = null;
    readonly memory: Memory = new Memory();
    model: string | null = null;
    serial: string | null = null;
    uptime: number | null = null;
}

export default SBC;

export * from "./dsf";
export * from "./CPU";
export * from "./Memory";
