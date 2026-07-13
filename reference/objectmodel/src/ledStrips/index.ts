import ModelObject from "../ModelObject";

export enum LedStripType {
    DotStar = "DotStar",
    NeoPixel_RGB = "NeoPixel_RGB",
    NeoPixel_RGBW = "NeoPixel_RGBW"
}

export class LedStrip extends ModelObject {
    board: number = 0;
    pin: string = "";
    stopMovement: boolean = false;
    type: LedStripType = LedStripType.DotStar;
}

export default LedStrip
