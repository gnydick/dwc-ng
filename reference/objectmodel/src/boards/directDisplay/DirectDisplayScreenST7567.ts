import { IModelObject } from "../../ModelObject";

import DirectDisplayScreenBase from "./DirectDisplayScreen";
import { DirectDisplayController, getDirectDisplayScreen } from ".";

export class DirectDisplayScreenST7567 extends DirectDisplayScreenBase {
    constructor() {
        super(DirectDisplayController.ST7567);
    }
    contrast: number = 30;
    resistorRatio: number = 6;

    override update(jsonElement: any): IModelObject | null {
        if (jsonElement === null) {
            return null;
        }

        if (typeof jsonElement.controller === "string" && jsonElement.controller !== this.controller) {
            return getDirectDisplayScreen(jsonElement.type).update(jsonElement);
        }
        return super.update(jsonElement);
    }
}

export default DirectDisplayScreenST7567
