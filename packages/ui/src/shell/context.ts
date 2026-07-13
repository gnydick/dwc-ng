import { createContext, useContext } from "solid-js";
import type { OmStore } from "../om/store.ts";
import type { ConfigStore } from "../config/store.ts";
import type { Connector } from "../connector/types.ts";

/** The app's three long-lived services, provided once at the root. */
export interface AppServices {
	om: OmStore;
	config: ConfigStore;
	connector: Connector;
}

export const AppContext = createContext<AppServices>();

export function useApp(): AppServices {
	const services = useContext(AppContext);
	if (services === undefined) throw new Error("AppContext is not provided");
	return services;
}
