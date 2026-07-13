import ModelObject from "../../ModelObject";

import DirectDisplayScreenBase from "./DirectDisplayScreenBase";
import DirectDisplayScreen from "./DirectDisplayScreen";
import { DirectDisplayScreenST7567 } from "./DirectDisplayScreenST7567";

export enum DirectDisplayController {
    ST7920 = "ST7920",
    ST7567 = "ST7567",
    ILI9488 = "ILI9488"
}

export class DirectDisplayEncoder extends ModelObject {
    pulsesPerClick: number = 1;
}

export class DirectDisplay extends ModelObject {
    constructor() {
        super();
        ModelObject.wrapModelProperty(this, "encoder", DirectDisplayEncoder);
    }
    encoder: DirectDisplayEncoder | null = new DirectDisplayEncoder();
    screen: DirectDisplayScreenBase = new DirectDisplayScreen(DirectDisplayController.ST7920);
}

export default DirectDisplay;

export function getDirectDisplayScreen(controller: DirectDisplayController): DirectDisplayScreen {
    switch (controller) {
        case DirectDisplayController.ST7920:
        case DirectDisplayController.ILI9488:
        default:
            return new DirectDisplayScreen(controller);
        case DirectDisplayController.ST7567:
            return new DirectDisplayScreenST7567();
    }
}

export * from "./DirectDisplayScreen";
export * from "./DirectDisplayScreenST7567";
