import ModelCollection from "../ModelCollection";
import ModelObject from "../ModelObject";
import Build from "./Build";
import GCodeFileInfo from "./GCodeFileInfo";

export class Layer extends ModelObject {
    duration: number = 0;
    filament: Array<number> = new Array<number>();
    fractionPrinted: number = 0;
    height: number = 0;
    temperatures: Array<number> = new Array<number>();
}

export class TimesLeft extends ModelObject {
    filament: number | null = null;
    file: number | null = null;
    slicer: number | null = null;
    toPause: number | null = null;
}

export class Job extends ModelObject {
    constructor() {
        super();
        ModelObject.wrapModelProperty(this, "build", Build);
        ModelObject.wrapModelProperty(this, "file", GCodeFileInfo);
    }

    build: Build = new Build();
    duration: number | null = null;
    file: GCodeFileInfo | null = null;
    filePosition: number | bigint | null = null;
    lastDuration: number | null = null;
    lastFileName: string | null = null;
    lastFileAborted: boolean = false;
    lastFileCancelled: boolean = false;
    lastFileSimulated: boolean = false;
    lastWarmUpDuration: number | null = null;
    layer: number | null = null;
    readonly layers: ModelCollection<Layer> = new ModelCollection(Layer);
    layerTime: number | null = null;
    pauseDuration: number | null = null;
    rawExtrusion: number | null = null;
    readonly timesLeft: TimesLeft = new TimesLeft();
    warmUpDuration: number | null = null;
}

export default Job

export * from "./Build"
export * from "./GCodeFileInfo"
export * from "./ThumbnailInfo"
