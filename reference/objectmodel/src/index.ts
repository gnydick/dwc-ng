// Expose all the sub-exports
export * from "./ModelCollection";
export * from "./ModelDictionary";
export * from "./ModelObject";
export * from "./ModelSet";

export * from "./boards";
export * from "./directories";
export * from "./fans";
export * from "./heat";
export * from "./inputs";
export * from "./job";
export * from "./ledStrips";
export * from "./limits";
export * from "./messages";
export * from "./move";
export * from "./network";
export * from "./plugins";
export * from "./sensors";
export * from "./spindles";
export * from "./sbc";
export * from "./state";
export * from "./tools";
export * from "./volumes";

export * from "./ObjectModel";

// Expose ObjectModel as default export
import ObjectModel from "./ObjectModel";
export default ObjectModel;

// Unfortunately we need to define a way to update arrays to remain compatible with Vue 2 (due to IE11).
// This will become obsolete as soon as DWC is upgraded to Vue 3, but that isn't going to happen anytime soon.
// Until then a Vue 2 user would have to call something like this on initialization to work around this limitation:
// globalThis._duetModelSetArray = (array, index, value) => Vue.set(array, index, value);
// or in TypeScript
// (globalThis as any)._duetModelSetArray = (array: object, index: string | number, value: any) => Vue.set(array, index, value);
(globalThis as any)._duetModelSetArray = (array: Array<any>, index: number, value: any) => array[index] = value;
export function setArrayItem(array: Array<any>, index: number, value: any) {
	(globalThis as any)._duetModelSetArray(array, index, value);
}
