import { ModelObject } from "..";

export class BoardClosedLoopCurrentFraction extends ModelObject {
    avg: number = 0;
    max: number = 0;
}

export class BoardClosedLoopPositionError extends ModelObject {
    max: number = 0;
    rms: number = 0;
}

export class DriverClosedLoop extends ModelObject {
    readonly currentFraction: BoardClosedLoopCurrentFraction = new BoardClosedLoopCurrentFraction();
    readonly positionError: BoardClosedLoopPositionError = new BoardClosedLoopPositionError();
}

export default class Driver extends ModelObject {
    constructor() {
        super();
        ModelObject.wrapModelProperty(this, "closedLoop", DriverClosedLoop);
    }

    closedLoop: DriverClosedLoop | null = null;
    status: number = 0;
}
