import ModelObject from "../ModelObject";
import ModelCollection from "../ModelCollection";
import NetworkInterface from "./NetworkInterface";

export const DefaultName = "My Duet";
export const DefaultHostname = "duet";
export const DefaultPassword = "reprap";

export class Network extends ModelObject {
    corsSite: string | null = null;
    hostname: string = DefaultHostname;
    readonly interfaces: ModelCollection<NetworkInterface> = new ModelCollection(NetworkInterface);
    name: string = DefaultName;
}

export default Network

export * from "./NetworkInterface";
