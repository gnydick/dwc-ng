import { createContext, useContext } from "solid-js";
import type { OmStore } from "../om/store.ts";
import type { ConfigStore } from "../config/store.ts";
import type { Connector } from "../connector/types.ts";
import type { TemperatureHistory } from "../om/temperature.ts";

/** The app's long-lived services, provided once at the root. */
export interface AppServices {
	om: OmStore;
	config: ConfigStore;
	connector: Connector;
	temps: TemperatureHistory;
}

export const AppContext = createContext<AppServices>();

export function useApp(): AppServices {
	const services = useContext(AppContext);
	if (services === undefined) throw new Error("AppContext is not provided");
	return services;
}
