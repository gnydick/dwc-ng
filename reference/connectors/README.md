# Connectors

TypeScript implementation of the Duet3D HTTP connectors.

## Installation

Install via `npm install @duet3d/connectors`.

## Bug reports

Please use the [forum](https://forum.duet3d.com) for support requests or the [DuetWebControl](https://github.com/Duet3D/DuetWebControl) GitHub repository for feature requests and bug reports.

## Usage

The connector works for both Duets in SBC and standalone mode. Usage is as simple as:

```
import { connect, BaseConnector, Callbacks, DefaultSettings } from "@duet3d/connectors";
import ObjectModel from "@duet3d/objectmodel";

// use initial settings
const settings = {
    ...DefaultSettings,
    // your custom settings
};

// try to establish a connection
let connector: BaseConnector;
try {
    const connector = connect(location.hostname, settings);
} catch (e) {
    console.error("Failed to establish connection: " + e);
    return;
}

// load settings from the machine - you can then update "settings" from your loaded settings again

// set up object model instance and stay updated via callbacks
const model = new ObjectModel();
connector.setCallbacks({
    onConnectProgress: function (connector: BaseConnector, progress: number): void {
        if (progress === -1) {
            console.log("Connection attempt complete");
        } else {
            console.log("Connection progress: " + progress + "%");
        }
    },
    onConnectionError: function (connector: BaseConnector, reason: unknown): void {
        console.log("Connection error: " + reason);
        // TODO call connector.reconnect in given intervals
    },
    onReconnected: function (connector: BaseConnector): void {
        console.log("Connection established again");
    },
    onUpdate: function (connector: BaseConnector, data: any): void {
        // Note that this is called before the final connector instance is returned!
        model.update(data);
    },
    onVolumeChanged: function (connector: BaseConnector, volumeIndex: number): void {
        // TODO reload file browser lists of the given volume
    }
});

// do whatever you want to do with the session, see BaseConnector API
```
