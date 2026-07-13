import { ModelCollection } from "../ModelCollection";
import { ModelObject } from "../ModelObject";

export class KeepoutZoneCoordinates extends ModelObject {
    max: number = 0;
    min: number = 0;
}

export default class KeepoutZone extends ModelObject {
    active: boolean = true;
    readonly coords: ModelCollection<KeepoutZoneCoordinates | null> = new ModelCollection(KeepoutZoneCoordinates);
}
