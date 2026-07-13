import ObjectModel, { Heater, initCollection } from "../src";
import { initObject } from "../src/ModelObject";
import Board from "../src/boards";
import Plugin, { PluginManifest, SbcPermission } from "../src/plugins";
import Move, { Axis, CoreKinematics, DeltaKinematics, DriverId, Extruder, KinematicsName } from "../src/move";
import { MachineStatus, MessageBox } from "../src/state";
import { LaserFilamentMonitor, RotatingMagnetFilamentMonitor } from "../src/sensors";
import Volume from "../src/volumes";

export const fullModel = { "boards": [], "directories": { "filaments": "0:/filaments", "firmware": "0:/firmware", "gCodes": "0:/gcodes", "macros": "0:/macros", "menu": "0:/menu", "scans": "0:/scans", "system": "0:/sys", "web": "0:/www" }, "fans": [], "global": {}, "heat": { "bedHeaters": [], "chamberHeaters": [], "coldExtrudeTemperature": 160, "coldRetractTemperature": 90, "heaters": [] }, "inputs": [{ "axesRelative": false, "compatibility": "RepRapFirmware", "distanceUnit": "mm", "drivesRelative": true, "feedRate": 50, "inMacro": false, "macroRestartable": false, "name": "HTTP", "stackDepth": 0, "state": "idle", "lineNumber": 0, "volumetric": false }, { "axesRelative": false, "compatibility": "RepRapFirmware", "distanceUnit": "mm", "drivesRelative": true, "feedRate": 50, "inMacro": false, "macroRestartable": false, "name": "Telnet", "stackDepth": 0, "state": "idle", "lineNumber": 0, "volumetric": false }, { "axesRelative": false, "compatibility": "RepRapFirmware", "distanceUnit": "mm", "drivesRelative": true, "feedRate": 50, "inMacro": false, "macroRestartable": false, "name": "File", "stackDepth": 0, "state": "idle", "lineNumber": 0, "volumetric": false }, { "axesRelative": false, "compatibility": "RepRapFirmware", "distanceUnit": "mm", "drivesRelative": true, "feedRate": 50, "inMacro": false, "macroRestartable": false, "name": "USB", "stackDepth": 0, "state": "idle", "lineNumber": 0, "volumetric": false }, { "axesRelative": false, "compatibility": "RepRapFirmware", "distanceUnit": "mm", "drivesRelative": true, "feedRate": 50, "inMacro": false, "macroRestartable": false, "name": "Aux", "stackDepth": 0, "state": "idle", "lineNumber": 0, "volumetric": false }, { "axesRelative": false, "compatibility": "RepRapFirmware", "distanceUnit": "mm", "drivesRelative": true, "feedRate": 50, "inMacro": false, "macroRestartable": false, "name": "Trigger", "stackDepth": 0, "state": "idle", "lineNumber": 0, "volumetric": false }, { "axesRelative": false, "compatibility": "RepRapFirmware", "distanceUnit": "mm", "drivesRelative": true, "feedRate": 50, "inMacro": false, "macroRestartable": false, "name": "Queue", "stackDepth": 0, "state": "idle", "lineNumber": 0, "volumetric": false }, { "axesRelative": false, "compatibility": "RepRapFirmware", "distanceUnit": "mm", "drivesRelative": true, "feedRate": 50, "inMacro": false, "macroRestartable": false, "name": "LCD", "stackDepth": 0, "state": "idle", "lineNumber": 0, "volumetric": false }, { "axesRelative": false, "compatibility": "RepRapFirmware", "distanceUnit": "mm", "drivesRelative": true, "feedRate": 50, "inMacro": false, "macroRestartable": false, "name": "SBC", "stackDepth": 0, "state": "idle", "lineNumber": 0, "volumetric": false }, { "axesRelative": false, "compatibility": "RepRapFirmware", "distanceUnit": "mm", "drivesRelative": true, "feedRate": 50, "inMacro": false, "macroRestartable": false, "name": "Daemon", "stackDepth": 0, "state": "idle", "lineNumber": 0, "volumetric": false }, { "axesRelative": false, "compatibility": "RepRapFirmware", "distanceUnit": "mm", "drivesRelative": true, "feedRate": 50, "inMacro": false, "macroRestartable": false, "name": "Autopause", "stackDepth": 0, "state": "idle", "lineNumber": 0, "volumetric": false }, { "axesRelative": false, "compatibility": "RepRapFirmware", "distanceUnit": "mm", "drivesRelative": true, "feedRate": 50, "inMacro": false, "macroRestartable": false, "name": "Unknown", "stackDepth": 0, "state": "idle", "lineNumber": 0, "volumetric": false }], "job": { "build": null, "duration": null, "file": { "filament": [], "fileName": null, "firstLayerHeight": 0, "generatedBy": null, "height": 0, "lastModified": null, "layerHeight": 0, "numLayers": 0, "printTime": null, "simulatedTime": null, "size": 0, "thumbnails": [] }, "filePosition": null, "lastDuration": null, "lastFileName": null, "lastFileAborted": false, "lastFileCancelled": false, "lastFileSimulated": false, "layer": null, "layers": [], "layerTime": null, "pauseDuration": null, "rawExtrusion": null, "timesLeft": { "filament": null, "file": null, "slicer": null }, "warmUpDuration": null }, "limits": { "axes": null, "axesPlusExtruders": null, "bedHeaters": null, "boards": null, "chamberHeaters": null, "drivers": null, "driversPerAxis": null, "extruders": null, "extrudersPerTool": null, "fans": null, "gpInPorts": null, "gpOutPorts": null, "heaters": null, "heatersPerTool": null, "monitorsPerHeater": null, "restorePoints": null, "sensors": null, "spindles": null, "tools": null, "trackedObjects": null, "triggers": null, "volumes": null, "workplaces": null, "zProbeProgramBytes": null, "zProbes": null }, "messages": [], "move": { "axes": [], "calibration": { "final": { "deviation": 0, "mean": 0 }, "initial": { "deviation": 0, "mean": 0 }, "numFactors": 0 }, "compensation": { "fadeHeight": 0, "file": null, "liveGrid": null, "meshDeviation": null, "probeGrid": { "axes": ["X", "Y"], "maxs": [-1, -1], "mins": [0, 0], "radius": 0, "spacings": [0, 0] }, "skew": { "compensateXY": true, "tanXY": 0, "tanXZ": 0, "tanYZ": 0 }, "type": "none" }, "currentMove": { "acceleration": 0, "deceleration": 0, "laserPwm": null, "requestedSpeed": 0, "topSpeed": 0 }, "extruders": [], "idle": { "factor": 0.3, "timeout": 30 }, "kinematics": { "name": "cartesian", "segmentation": null }, "printingAcceleration": 10000, "queue": [], "rotation": { "angle": 0, "centre": [0, 0] }, "shaping": { "amplitudes": [], "damping": 0.2, "durations": [], "frequency": 0, "minAcceleration": 10, "type": "none" }, "speedFactor": 1, "travelAcceleration": 10000, "virtualEPos": 0, "workplaceNumber": 0 }, "network": { "corsSite": null, "hostname": "test", "interfaces": [{ "activeProtocols": [], "actualIP": "192.168.1.122", "configuredIP": "192.168.1.122", "dnsServer": null, "firmwareVersion": null, "gateway": "192.168.1.254", "mac": "DC:A6:32:04:59:E3", "numReconnects": null, "signal": null, "speed": null, "subnet": "255.255.255.0", "type": "wifi" }], "name": "My Duet" }, "plugins": {}, "scanner": { "progress": 0, "status": "D" }, "sensors": { "analog": [], "endstops": [], "filamentMonitors": [], "gpIn": [], "probes": [] }, "sbc": { "dsf": { "version": "3.5-b4" } }, "spindles": [], "state": { "atxPower": null, "atxPowerPort": null, "beep": null, "currentTool": -1, "displayMessage": "", "gpOut": [], "laserPwm": -1, "logFile": null, "logLevel": "off", "messageBox": { "axisControls": 0, "message": "message", "mode": 2, "seq": -1, "timeout": 0, "title": "title" }, "machineMode": "FFF", "macroRestarted": false, "msUpTime": 0, "nextTool": -1, "pluginsStarted": false, "powerFailScript": "", "previousTool": -1, "restorePoints": [], "status": "idle", "time": null, "upTime": 0 }, "tools": [], "userSessions": [], "volumes": [{ "capacity": 58851373056, "freeSpace": 55021527040, "mounted": true, "name": null, "openFiles": null, "path": "/", "speed": null }, { "capacity": 2143281152, "freeSpace": 2087972864, "mounted": true, "name": null, "openFiles": null, "path": "/boot", "speed": null }] };

export const patch = {
    "boards": [
        {
            "firmwareFileName": "Test"
        }
    ],
    "heat": {
        "heaters": [
            {
                "current": 12.34
            }
        ]
    },
    "move": {
        "kinematics": {
            "name": "delta",
            "deltaRadius": 123
        }
    },
    "plugins": {
        "foobar": {
            "id": "foobar",
            "name": "Foo 123"
        }
    },
    "sensors": {
        "filamentMonitors": [
            {
                "type": "laser"
            }
        ]
    }
};

test("fullModel", () => {
    const model = new ObjectModel();
    model.update(fullModel);
    expect(model.volumes.length).toBe(2);
    expect(model.volumes[0]).toBeInstanceOf(Volume);
    expect(model.sbc!.dsf.version).toBe("3.5-b4");
});

test("patch", () => {
    const model = new ObjectModel();
    model.update(fullModel);

    model.update(patch);
    expect(model.boards[0]).toBeInstanceOf(Board);
    expect(model.boards[0]).toBeInstanceOf(Board);
    expect(model.heat.heaters[0]).toBeInstanceOf(Heater);
    expect(model.move.kinematics).toBeInstanceOf(DeltaKinematics);
    expect((model.move.kinematics as DeltaKinematics).deltaRadius).toBe(123);
    expect(model.plugins.size).toBe(1);
    expect(model.plugins.get("foobar")).toBeInstanceOf(Plugin);
    expect(model.plugins.get("foobar")!.id).toBe("foobar");
    expect(model.plugins.get("foobar")!.name).toBe("Foo 123");
    expect(model.sensors.filamentMonitors.length).toBe(1);
    expect(model.sensors.filamentMonitors[0]).toBeInstanceOf(LaserFilamentMonitor);

    const otherModel = new ObjectModel();
    otherModel.update(model);
    expect(otherModel.plugins.size).toBe(1);
    expect(otherModel.plugins.get("foobar")).toBeInstanceOf(Plugin);
    expect(otherModel.plugins.get("foobar")!.id).toBe("foobar");
    expect(otherModel.plugins.get("foobar")!.name).toBe("Foo 123");

    model.update({"plugins": null});
    expect(model.plugins.size).toBe(0);
});

const stateKey = {
    "atxPower": null,
    "beep": null,
    "currentTool": -1,
    "displayMessage": "",
    "laserPwm": null,
    "logFile": "",
    "machineMode": "FFF",
    "messageBox": {
        "axisControls": 0,
        "message": "Please go to <a href=\"https://www.duet3d.com/StartHere\" target=\"_blank\">this</a> page for further instructions on how to set it up.",
        "mode": 1,
        "seq": 1,
        "timeout": 0,
        "title": "Welcome your new Duet 3!"
    },
    "nextTool": -1,
    "powerFailScript": "",
    "previousTool": -1,
    "status": "busy",
    "upTime": 1002
};

test("patchState", () => {
    const model = new ObjectModel();
    model.update(fullModel);
    model.state.update(stateKey);
    expect(model.state.messageBox).toBeInstanceOf(MessageBox);
    expect(model.state.messageBox!.title).toBe("Welcome your new Duet 3!");
    expect(model.state.status).toBe(MachineStatus.busy);
    expect(model.state.upTime).toBe(1002);
});

const filamentMonitorJson = {sensors:{filamentMonitors:[{calibrated:null,configured:{allMoves:false,mmPerRev:25.4,percentMax:140,percentMin:70,sampleDistance:12.7},enabled:true,status:"noDataReceived",type:"rotatingMagnet"}]}};
const filamentMonitorUpdateJson = {sensors:{filamentMonitors:[{configured:{percentMax:147,percentMin:60}}]}};

test("updateFilamentMonitor", () => {
    const model = new ObjectModel();
    model.update(filamentMonitorJson);
    expect(model.sensors.filamentMonitors.length).toBe(1);
    expect(model.sensors.filamentMonitors[0]).toBeInstanceOf(RotatingMagnetFilamentMonitor);
    expect((model.sensors.filamentMonitors[0] as RotatingMagnetFilamentMonitor).calibrated).toBeNull();
    expect((model.sensors.filamentMonitors[0] as RotatingMagnetFilamentMonitor).configured.percentMax).toBe(140);
    expect((model.sensors.filamentMonitors[0] as RotatingMagnetFilamentMonitor).configured.percentMin).toBe(70);

    model.update(filamentMonitorUpdateJson);
    expect(model.sensors.filamentMonitors.length).toBe(1);
    expect(model.sensors.filamentMonitors[0]).toBeInstanceOf(RotatingMagnetFilamentMonitor);
    expect((model.sensors.filamentMonitors[0] as RotatingMagnetFilamentMonitor).configured.percentMax).toBe(147);
    expect((model.sensors.filamentMonitors[0] as RotatingMagnetFilamentMonitor).configured.percentMin).toBe(60);
});

test("updateExtruder", () => {
	const extruder = new Extruder();

	const newDriverId = new DriverId();
	newDriverId.board = 0;
	newDriverId.driver = 4;

	extruder.update({ driver: newDriverId });
	expect(extruder.driver!.board).toBe(0);
	expect(extruder.driver!.driver).toBe(4);
});

test("updateKinematics", () => {
	const model = initObject(ObjectModel, {
		move: initObject(Move, {
			kinematics: new CoreKinematics(KinematicsName.coreXY)
		})
	});
	expect(model.move.kinematics.name).toBe(KinematicsName.coreXY);

	model.update({ move: { kinematics: { name: KinematicsName.delta } } })
	expect(model.move.kinematics.name).toBe(KinematicsName.delta);
});

test("updatePlugin", () => {
    const model = new ObjectModel();
    model.plugins.set("foobar", initObject(Plugin, { id: "foobar", name: "foo bar" }));
    
    const updateData = {
        plugins: {
            foobar: {
                pid: 123
            }
        }
    };
    model.update(updateData);

    expect(model.plugins.get("foobar")?.id).toBe("foobar");
    expect(model.plugins.get("foobar")?.name).toBe("foo bar");
    expect(model.plugins.get("foobar")?.pid).toBe(123);
});

test("axisDrivers", () => {
    const model = new ObjectModel();
    model.move.axes.push(initObject(Axis, { drivers: initCollection(DriverId, [{ board: 1, driver: 12 }]) }));
    model.move.axes[0].update({ "drivers": ["0.5"] });

    expect(model.move.axes[0].drivers.length).toBe(1);
    expect(model.move.axes[0].drivers[0].board).toBe(0);
    expect(model.move.axes[0].drivers[0].driver).toBe(5);
});

test("pluginManifestSet", () => {
    const pluginManifest = { id: "foo", sbcPermissions: ["commandExecution"] };
    const manifest = initObject(PluginManifest, pluginManifest as any);

    expect(manifest.id).toBe("foo");
    expect(manifest.sbcPermissions.has(SbcPermission.commandExecution)).toBeTruthy();
});

test("plguinData", () => {
    const model = new ObjectModel();
    model.update({ plugins: { foo: { data: { keyA: 123, keyB: 456 } } } });

    model.update({ plugins: { foo: { data: { keyA: 789 } } } });

    expect(Array.from(model.plugins.get("foo")!.data.keys()).length).toBe(2);
    expect(model.plugins.get("foo")!.data.get("keyA")).toBe(789);
});

test("messageBoxDefault", () => {
    const model = new ObjectModel();

    // Initial assignment
    model.update({ state: { messageBox: { default: 123 }}});
    expect(model.state.messageBox?.default).toBe(123);

    // Reset
    model.update({ state: { messageBox: { default: null }}});
    expect(model.state.messageBox?.default).toBeNull();

    // Set to string
    model.update({ state: { messageBox: { default: "foobar" }}});
    expect(model.state.messageBox?.default).toBe("foobar");

    // Set to number
    model.update({ state: { messageBox: { default: 456 } }});
    expect(model.state.messageBox?.default).toBe(456);
});
