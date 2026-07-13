import { FilamentMonitorBase, FilamentMonitorType } from "./FilamentMonitorBase";

export class Duet3DFilamentMonitor extends FilamentMonitorBase {
    avgPercentage: number | null = null;
    lastPercentage: number | null = null;
    maxPercentage: number | null = null;
    minPercentage: number | null = null;
    position: number = 0;
    totalExtrusion: number = 0;

    constructor(type: FilamentMonitorType = FilamentMonitorType.unknown) {
        super(type);
    }
}

export default Duet3DFilamentMonitor
