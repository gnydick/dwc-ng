import ModelObject, { IModelObject } from "../ModelObject";
import ModelSet from "../ModelSet";

export enum SbcPermission {
    none = "none",
    commandExecution = "commandExecution",
    codeInterceptionRead = "codeInterceptionRead",
    codeInterceptionReadWrite = "codeInterceptionReadWrite",
    managePlugins = "managePlugins",
    servicePlugins = "servicePlugins",
    manageUserSessions = "manageUserSessions",
    objectModelRead = "objectModelRead",
    objectModelReadWrite = "objectModelReadWrite",
    registerHttpEndpoints = "registerHttpEndpoints",
    readFilaments = "readFilaments",
    writeFilaments = "writeFilaments",
    readFirmware = "readFirmware",
    writeFirmware = "writeFirmware",
    readGCodes = "readGCodes",
    writeGCodes = "writeGCodes",
    readMacros = "readMacros",
    writeMacros = "writeMacros",
    readMenu = "readMenu",
    writeMenu = "writeMenu",
    readSystem = "readSystem",
    writeSystem = "writeSystem",
    readWeb = "readWeb",
    writeWeb = "writeWeb",
    fileSystemAccess = "fileSystemAccess",
    launchProcesses = "launchProcesses",
    networkAccess = "networkAccess",
    webcamAccess = "webcamAccess",
    gpioAccess = "gpioAccess",
    superUser = "superUser"
}

export class PluginManifest extends ModelObject {
    /**
     * Constructor of this class
     * @param itemConstructor Item constructor type that items must derive from
     */
    constructor() {
        super();

        let id = "";
        Object.defineProperty(this, "id", {
            enumerable: true,
            get(): string { return id; },
            set(value: string) {
                if (!value || value.length > 32) {
                    throw new Error("Invalid plugin identifier");
                }
                for (const c in value.split("")) {
                    if (!/\w/.test(c)) {
                        throw new Error("Illegal plugin identifier");
                    }
                }
                id = value;
            }
        });

        let name = "";
        Object.defineProperty(this, "name", {
            enumerable: true,
            get(): string { return name; },
            set(value: string) {
                if (!value || value.length > 64) {
                    throw new Error("Invalid plugin name");
                }
                for (const c in value.split("")) {
                    if (!/[\w -_]/.test(c)) {
                        throw new Error("Illegal plugin name");
                    }
                }
                name = value;
            }
        });
    }

    id: string = "";
    name: string = "";
    author: string = "";
    version: string = "1.0.0";
    license: string = "LGPL-3.0-or-later";
    homepage: string | null = null;
    tags: Array<string> = [];
    dwcVersion: string | null = null;
    dwcDependencies: Array<string> = [];
    sbcRequired: boolean = false;
    sbcDsfVersion: string | null = null;
    sbcExecutable: string | null = null;
    sbcExecutableArguments: string | null = null;
    sbcExtraExecutables: Array<string> = [];
    sbcAutoRestart: boolean = false;
    sbcOutputRedirected: boolean = true;
    sbcPermissions: ModelSet<SbcPermission> = new ModelSet<SbcPermission>();
    sbcConfigFiles: Array<string> = [];
    sbcPackageDependencies: Array<string> = [];
    sbcPluginDependencies: Array<string> = [];
    sbcPythonDependencies: Array<string> = [];
    rrfVersion: string | null = null;
    data: Map<string, any> = new Map<string, any>();

    static checkVersion(actual: string, required: string): boolean {
        if (required) {
            const actualItems = actual.split(/[.\-+]/);
            const requiredItems = required.split(/[.\-+]/);
            for (let i = 0; i < Math.min(actualItems.length, requiredItems.length); i++) {
                if (actualItems[i] !== requiredItems[i]) {
                    return false;
                }
            }
        }
        return true;
    }

    public override update(jsonElement: any): IModelObject | null {
        if (typeof jsonElement.data === "object") {
            for (const key in jsonElement.data) {
                this.data.set(key, jsonElement.data[key]);
            }
            delete jsonElement.data;
        }
        return super.update(jsonElement);
    }
}

export default PluginManifest
