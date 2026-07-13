import ModelObject from "../ModelObject";
import ModelSet from "../ModelSet";

export enum NetworkProtocol {
    HTTP = "http",
    HTTPS = "https",
    FTP = "ftp",
    SFTP = "sftp",
    Telnet = "telnet",
    SSH = "ssh"
}

export enum NetworkInterfaceState {
	disabled = "disabled",
	enabled = "enabled",
	starting1 = "starting1",
	starting2 = "starting2",
	changingMode = "changingMode",
	establishingLink = "establishingLink",
	obtainingIP = "obtainingIP",
	connected = "connected",
    active = "active",
    idle = "idle"
}

export enum NetworkInterfaceType {
    ethernet = "ethernet",
    wifi = "wifi"
}

export class NetworkInterface extends ModelObject {
    activeProtocols: ModelSet<NetworkProtocol> = new ModelSet<NetworkProtocol>();
    actualIP: string | null = null;
    configuredIP: string | null = null;
    dnsServer: string | null = null;
    firmwareVersion: string | null = null;
    gateway: string | null = null;
    mac: string | null = null;
    numReconnects: number | null = null;
    rssi: number | null = null;
    /** @deprecated use rssi instead */
    signal: number | null = null;
    speed: number | null = null;
    ssid: string | null = null;
	state: NetworkInterfaceState | null = null;
    subnet: string | null = null;
    type: NetworkInterfaceType = NetworkInterfaceType.wifi;
    wifiCountry: string | null = null;
}

export default NetworkInterface
