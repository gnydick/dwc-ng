import ModelObject from "../ModelObject";

export class CPU extends ModelObject {
    avgLoad: number | null = null;
    hardware: string | null = null;
    numCores: number = 1;
    temperature: number | null = null;
}

export default CPU;
