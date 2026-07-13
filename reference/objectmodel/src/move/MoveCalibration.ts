import ModelObject from "../ModelObject";

export class MoveDeviations extends ModelObject {
    deviation: number = 0;
    mean: number = 0;
}

export class MoveCalibration extends ModelObject {
    readonly final: MoveDeviations = new MoveDeviations();
    readonly initial: MoveDeviations = new MoveDeviations();
    numFactors: number = 0;
}

export default MoveCalibration
