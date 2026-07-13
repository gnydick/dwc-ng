import ModelCollection from "../ModelCollection";
import ModelDictionary from "../ModelDictionary";
import ModelObject from "../ModelObject";

import ThumbnailInfo from "./ThumbnailInfo";

export class GCodeFileInfo extends ModelObject {
    readonly customInfo: ModelDictionary<any> = new ModelDictionary(false);
    filament: Array<number> = new Array<number>();
    fileName: string = "";
    generatedBy: string = "";
    height: number = 0;
    lastModified: string | null = null;
    layerHeight: number = 0;
    numLayers: number = 0;
    printTime: number | bigint | null = null;
    simulatedTime: number | bigint | null = null;
    size: number | bigint = 0;
    readonly thumbnails: ModelCollection<ThumbnailInfo> = new ModelCollection(ThumbnailInfo);
}

export default GCodeFileInfo
