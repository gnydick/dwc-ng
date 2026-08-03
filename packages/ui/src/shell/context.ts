import { createContext, useContext } from "solid-js";
import type { OmStore } from "../om/store.ts";
import type { ConfigStore } from "../config/store.ts";
import type { Connector } from "@dwc-ng/connector";
import type { Backend } from "../dev/backend.ts";
import type { TemperatureHistory } from "../om/temperature.ts";

/** The app's long-lived services, provided once at the root. */
export interface AppServices {
	om: OmStore;
	config: ConfigStore;
	connector: Connector;
	temps: TemperatureHistory;
	/** The backend this session drives. Decided once at boot and passed in —
	 *  never derived here, so nothing can read it before it exists. */
	backend: Backend;
}

export const AppContext = createContext<AppServices>();

export function useApp(): AppServices {
	const services = useContext(AppContext);
	if (services === undefined) throw new Error("AppContext is not provided");
	return services;
}
