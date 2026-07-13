import ModelObject from "../ModelObject";

export class Limits extends ModelObject {
    axes: number | null = null;
    axesPlusExtruders: number | null = null;
    bedHeaters: number | null = null;
    boards: number | null = null;
    chamberHeaters: number | null = null;
    drivers: number | null = null;
    driversPerAxis: number | null = null;
    extruders: number | null = null;
    extrudersPerTool: number | null = null;
    fans: number | null = null;
    gpInPorts: number | null = null;
    gpOutPorts: number | null = null;
    heaters: number | null = null;
    heatersPerTool: number | null = null;
    ledStrips: number | null = null;
    monitorsPerHeater: number | null = null;
    portsPerHeater: number | null = null;
    reportedAxes: number | null = null;
    restorePoints: number | null = null;
    sensors: number | null = null;
    spindles: number | null = null;
    tools: number | null = null;
    trackedObjects: number | null = null;
    triggers: number | null = null;
    volumes: number | null = null;
    workplaces: number | null = null;
    zProbeProgramBytes: number | null = null;
    zProbes: number | null = null;
}

export default Limits
