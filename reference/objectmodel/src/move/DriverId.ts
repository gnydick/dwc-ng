import ModelObject, { IModelObject } from "../ModelObject";

export function isDriverId(value: any): value is DriverId {
	return (value instanceof Object) && value.board !== undefined && value.driver !== undefined;
}

export class DriverId extends ModelObject {
    board: number | null = null;
    driver: number = 0;

	equals(value?: DriverId | null) {
        if (isDriverId(value)) {
            if (!this.board && !value.board) {
                return this.driver === value.driver;
            }
            return (value.board === this.board) && (value.driver === this.driver);
        }
        return false;
	}

    override update(jsonElement: any): IModelObject | null {
		if (isDriverId(jsonElement)) {
			this.board = jsonElement.board;
			this.driver = jsonElement.driver;
			return this;
		}

	    if (typeof jsonElement === "string") {
            const matches = /(\d+)\.(\d+)/.exec(jsonElement);
            if (matches !== null) {
                this.board = Number(matches[1]);
                this.driver = Number(matches[2]);
            } else {
                this.board = null;
                this.driver = Number(jsonElement);
            }
            return this;
        }

	    return null;
    }

    override toString() {
        return (this.board === null) ? this.driver.toString() : `${this.board}.${this.driver}`;
    }
}

export default DriverId
