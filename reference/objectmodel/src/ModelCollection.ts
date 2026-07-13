import { IModelObject, isModelObject } from "./ModelObject";
import { setArrayItem } from "./index";

/**
 * Internal interface for the model collection class
 */
interface IModelCollection {
    $itemConstructor: { new(): IModelObject | null };
}

/**
 * Class for storing model object items in an array
 */
export class ModelCollection<T extends IModelObject | null> extends Array<T> implements IModelObject {
    /**
     * Constructor of this class
     * @param itemConstructor Item constructor type that items must derive from
     */
    constructor(itemConstructor: { new(): T }) {
        super();
        Object.setPrototypeOf(this, ModelCollection.prototype);

        Object.defineProperty(this, "$itemConstructor", { enumerable: false, value: itemConstructor });
    }

    // Unfortunately it isn't possible to override index operators in JS/TS

    /**
     * Overridden push method to perform better type checks
     * @param items Items to add
     */
    override push(...items: T[]): number {
        const that = this as any as IModelCollection;

        for (const item of items) {
            if (item === null || item instanceof that.$itemConstructor) {
                super.push(item);
            } else {
                const newItem: T = new that.$itemConstructor() as T;
                super.push(newItem!.update(item) as T);
            }
        }
        return this.length;
    }

    /**
     * Update this instance from the given data
     * @param jsonElement JSON data to upgrade this instance from
     * @returns Updated instance
     */
    update(jsonElement: any): IModelObject | null {
        if (jsonElement === null) {
            return null;
        }
        if (!(jsonElement instanceof Array)) {
            throw new Error(`Invalid JSON element type for model collection ${typeof jsonElement}`);
        }
        const that = this as any as IModelCollection;

        // Remove deleted items
        this.splice(jsonElement.length);

        // Update existing items
        for (let i = 0; i < Math.min(jsonElement.length, this.length); i++) {
            const currentItem = this[i];
            if (currentItem === null) {
                const newItem = jsonElement[i];
                if (newItem instanceof that.$itemConstructor) {
                    setArrayItem(this, i, jsonElement[i]);
                } else {
                    const refItem = new that.$itemConstructor();
                    setArrayItem(this, i, refItem!.update(newItem));
                }
            } else if (isModelObject(currentItem)) {
                const newItem = currentItem.update(jsonElement[i]);
                if (currentItem !== newItem) {
                    setArrayItem(this, i, newItem);
                }
            } else {
                const newItem = jsonElement[i];
                if (currentItem !== newItem) {
                    setArrayItem(this, i, newItem);
                }
            }
        }

        // Add new items
        for (let i = this.length; i < jsonElement.length; i++) {
			const itemToAdd = jsonElement[i];
			if (itemToAdd === null) {
				super.push(itemToAdd);
			} else {
				const newItem: T = new that.$itemConstructor() as T;
				super.push(newItem!.update(itemToAdd) as T);
			}
        }
        return this;
    }
}

export default ModelCollection

/**
 * Initialize a model collection from the given data
 * @param itemType Item type to create
 * @param data Data to assign
 * @returns Initialized model collection
 */
export function initCollection<T extends IModelObject>(itemType: { new(): T }, data: Array<{ [Property in keyof T]?: T[Property]; }>): ModelCollection<T> {
	const result = new ModelCollection(itemType);
	for (let presetItem of data) {
		const item = new itemType();
		result.push(item.update(presetItem) as any);
	}
	return result;
}
