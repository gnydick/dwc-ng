import ModelObject from "../ModelObject";
import ModelCollection from "../ModelCollection";
import AnalogSensor from "./AnalogSensor";
import Endstop from "./Endstop";
import FilamentMonitor from "./FilamentMonitors";
import Probe from "./Probe";

export class GpInputPort extends ModelObject {
    value: number = 0;
}

export class Sensors extends ModelObject {
    readonly analog: ModelCollection<AnalogSensor | null> = new ModelCollection(AnalogSensor);
    readonly endstops: ModelCollection<Endstop | null> = new ModelCollection(Endstop);
    readonly filamentMonitors: ModelCollection<FilamentMonitor | null> = new ModelCollection(FilamentMonitor);
    readonly gpIn: ModelCollection<GpInputPort | null> = new ModelCollection(GpInputPort);
    readonly probes: ModelCollection<Probe | null> = new ModelCollection(Probe);
}

export default Sensors

export * from "./FilamentMonitors";
export * from "./AnalogSensor";
export * from "./Endstop";
export * from "./Probe";
