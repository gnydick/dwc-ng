import BaseConnector from "./BaseConnector";

/**
 * Class holding possible callbacks for the connector
 */
export interface Callbacks {
    /**
     * Called to report the progress while establishing a connection (again)
     * @param connector Connector instance
     * @param progress Connection progress in percent (0..100) or -1 when the connect process has finished
     */
    onConnectProgress: (connector: BaseConnector, progress: number) => void;

    /**
     * Connection has been lost
     * The callee may attempt to reconnect in given intervals by calling connector.reconnect()
     * @param connector Connector instance
     * @param reason Reason for the connection loss
     */
    onConnectionError: (connector: BaseConnector, reason: unknown) => void;

    /**
     * Connector has established a connection again
     * @param connector Connector instance
     */
    onReconnected: (connector: BaseConnector) => void;

    /***
     * Object model update has been received
     * The received data can be patched into the object model instance via omInstance.update(data)
     * Note that this is called before the final connector instance is returned!
     */
    onUpdate: (connector: BaseConnector, data: any) => void;

    /**
     * Files or directories have been changed on the given volume
     * @param connector Connector instance
     * @param volumeIndex Index of the volume where files or directories have been changed
     */
    onVolumeChanged: (connector: BaseConnector, volumeIndex: number) => void;
}
export default Callbacks
