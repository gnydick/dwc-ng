import ModelObject, { IModelObject } from "../ModelObject";

export enum MessageBoxMode {
    noButtons,
    closeOnly,
    okOnly,
    okCancel,
    multipleChoice,
	intInput,
	floatInput,
	stringInput
}

export class MessageBox extends ModelObject {
    axisControls: number | null = null;
    cancelButton: boolean = false;
    choices: Array<string> | null = null;
    default: number | string | null = null;
    max: number | null = null;
    message: string = "";
    min: number | null = null;
    mode: MessageBoxMode = MessageBoxMode.okOnly;
    seq: number = -1;
    timeout: number = 0;
    title: string = "";

    override update(jsonElement: any): IModelObject | null {
        if (jsonElement instanceof Object && (typeof jsonElement.default === "number" || typeof jsonElement.default === "string")) {
            this.default = jsonElement.default;
        }
        return super.update(jsonElement);
    }
}

export default MessageBox
