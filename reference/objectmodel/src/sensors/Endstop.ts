import ModelObject from "../ModelObject";

export enum EndstopType {
    InputPin = "inputPin",
    ZProbeAsEndstop = "zProbeAsEndstop",
    motorStallAny = "motorStallAny",
    motorStallIndividual = "motorStallIndividual",
    unknown = "unknown"
}

export class Endstop extends ModelObject {
    highEnd: boolean = false;
    probe: number | null = null;
    triggered: boolean = false;
    type: EndstopType = EndstopType.unknown;
}

export default Endstop
