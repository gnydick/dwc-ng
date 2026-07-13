import ModelCollection from "../../ModelCollection";
import ModelObject from "../../ModelObject";

import HttpEndpoint from "./HttpEndpoint";
import UserSession from "./UserSession";

export class DSF extends ModelObject {
    buildDateTime: string = "";
    readonly httpEndpoints: ModelCollection<HttpEndpoint> = new ModelCollection(HttpEndpoint);
    is64Bit: boolean = false;
    pluginSupport: boolean = false;
    rootPluginSupport: boolean = false;
	readonly userSessions: ModelCollection<UserSession> = new ModelCollection(UserSession);
    version: string = "";
}

export default DSF;

export * from "./HttpEndpoint";
