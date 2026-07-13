import ModelObject from "../../ModelObject";

import { DirectDisplayController } from ".";

export class DirectDisplayScreenBase extends ModelObject {
    constructor(type: DirectDisplayController) {
        super();
        this.controller = type;
    }
    colourBits: number = 1;
    controller: DirectDisplayController;
    height: number = 64;
    spiFreq: number = 2000000;
    width: number = 128;
}

export default DirectDisplayScreenBase
