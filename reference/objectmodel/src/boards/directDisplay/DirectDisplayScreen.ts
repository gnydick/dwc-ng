import { IModelObject } from "../../ModelObject";

import { getDirectDisplayScreen } from ".";
import DirectDisplayScreenBase from "./DirectDisplayScreenBase";

export class DirectDisplayScreen extends DirectDisplayScreenBase {
    override update(jsonElement: any): IModelObject | null {
        if (jsonElement === null) {
            return null;
        }

        if (typeof jsonElement.controller === "string" && jsonElement.controller !== this.controller) {
            return getDirectDisplayScreen(jsonElement.controller).update(jsonElement);
        }
        return super.update(jsonElement);
    }
}

export default DirectDisplayScreen
