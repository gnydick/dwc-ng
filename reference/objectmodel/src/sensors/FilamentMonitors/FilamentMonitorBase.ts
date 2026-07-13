import ModelObject from "../../ModelObject";

export enum FilamentMonitorStatus {
    noMonitor = "noMonitor",
    ok = "ok",
    noDataReceived = "noDataReceived",
    noFilament = "noFilament",
    tooLittleMovement = "tooLittleMovement",
    tooMuchMovement = "tooMuchMovement",
    sensorError = "sensorError"
}

export enum FilamentMonitorType {
    simple = "simple",
    laser = "laser",
    pulsed = "pulsed",
    rotatingMagnet = "rotatingMagnet",
    unknown = "unknown"
}

export enum FilamentMonitorEnableMode {
    disabled = 0,
    enabled = 1,
    alwaysEnabled = 2
}

export class FilamentMonitorBase extends ModelObject {
    /**
     * @deprecated use enableMode instead
     */
    enabled: boolean = false;

    enableMode: FilamentMonitorEnableMode = FilamentMonitorEnableMode.disabled;
    status: FilamentMonitorStatus = FilamentMonitorStatus.noDataReceived;
    type: FilamentMonitorType;

    constructor(type: FilamentMonitorType = FilamentMonitorType.unknown) {
        super();
        this.type = type;
    }
}

export default FilamentMonitorBase
