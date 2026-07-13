import PluginManifest from "./PluginManifest";

export class Plugin extends PluginManifest {
    dsfFiles: Array<string> = [];
    dwcFiles: Array<string> = [];
    sdFiles: Array<string> = [];
    pid: number = -1;
}

export default Plugin

export * from "./PluginManifest";
