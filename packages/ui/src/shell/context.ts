import { createContext, useContext, type Accessor } from "solid-js";
import type { OmStore } from "../om/store.ts";
import type { ConfigStore } from "../config/store.ts";
import type { Connector } from "@dwc-ng/connector";
import type { Backend } from "../dev/backend.ts";
import type { TemperatureHistory } from "../om/temperature.ts";
import type { MachineId } from "../config/machineId.ts";

/** The app's long-lived services, provided once at the root. */
export interface AppServices {
	om: OmStore;
	config: ConfigStore;
	connector: Connector;
	temps: TemperatureHistory;
	/** The backend this session drives. Decided once at boot and passed in —
	 *  never derived here, so nothing can read it before it exists. */
	backend: Backend;
	/**
	 * Which machine the UI thinks it is talking to right now (config/
	 * machineSession.ts's `id`, App.tsx's ONE session — never a second call
	 * to resolveMachineId). Starts `unidentified` and resolves about a poll
	 * after boot; a card reading this must render both states, since that is
	 * exactly the transition the System identity card exists to show.
	 */
	machineId: Accessor<MachineId>;
	/**
	 * True once the FIRST `config.loadFromMachine` attempt for this boot has
	 * SETTLED — resolved (a real file, no file at all, or a claim) or
	 * rejected (a connect/download failure App.tsx already swallows) alike.
	 * False for the whole window between boot and that settlement, covering
	 * BOTH "identity has not resolved yet" AND "identity resolved but the SD
	 * download is still in flight" — the second half of that window is
	 * exactly where GIT_86 Critical 2 lived: `machineStore()` can go non-null
	 * before `loadFromMachine` has had a chance to run at all (identity
	 * resolves inside `connector.connect()`'s fullSync; the load is chained
	 * AFTER `connect()` resolves — App.tsx), so a consumer keying off identity
	 * ALONE can construct against a machine half that still reads as `{}`
	 * and never gets another chance to look again.
	 */
	configLoaded: Accessor<boolean>;
}

export const AppContext = createContext<AppServices>();

export function useApp(): AppServices {
	const services = useContext(AppContext);
	if (services === undefined) throw new Error("AppContext is not provided");
	return services;
}
