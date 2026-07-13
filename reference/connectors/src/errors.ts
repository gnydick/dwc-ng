/**
 * Abstract method not implemented
 */
export class NotImplementedError extends Error {
    override name: string = "NotImplementedError";

    /**
     * Name of the method that is not implemented
     */
    field: string;

    constructor(field: string) {
        super(`${field} is not implemented`);
        this.field = field;
	}
}

/**
 * Base class for network errors
 */
export class NetworkError extends Error {
    override name: string = "NetworkError";

    /**
     * Reason for the error, if any
     */
    reason: string | null;

    constructor(reason: string | null = null) {
        super(reason ? `Network error: ${reason}` : "Network error");
        this.reason = reason;
	}
}

/**
 * Session terminated while an action was being performed
 */
export class DisconnectedError extends NetworkError {
    override name: string = "DisconnectedError";

    constructor() {
        super("Could not complete action because the connection has been terminated");
	}
}

/**
 * Request timed out
 */
export class TimeoutError extends NetworkError {
    override name: string = "TimeoutError";

    constructor() {
        super("Request timed out");
	}
}

/**
 * Operation was cancelled
 */
export class OperationCancelledError extends NetworkError {
    override name: string = "OperationCancelledError";

    constructor() {
        super("Operation cancelled");
	}
}

/**
 * Operation failed (e.g. firmware returned error code)
 */
export class OperationFailedError extends NetworkError {
    override name: string = "OperationFailedError";

    /**
     * Reason for the failure
     */
	reason: string | null = null;

    constructor(reason: string | null = null) {
        super(reason ? `Operation failed: ${reason}` : "Operation failed");
		this.reason = reason;
	}
}

/**
 * Base class for file IO errors
 */
export class FileError extends Error {
    override name: string = "FileError";

    /**
     * Reason for the error, if any
     */
    reason: string | null;

    constructor(reason: string | null) {
        super(reason ? `Network error: ${reason}` : "Network error");
        this.reason = reason;
	}
}

/**
 * Requested drive is not mounted
 */
export class DriveUnmountedError extends FileError {
    override name: string = "DriveUnmountedError";

    constructor() {
        super("Drive is not mounted");
	}
}

/**
 * Requested file not found
 */
export class FileNotFoundError extends FileError {
    override name: string = "FileNotFoundError";

    /**
     * Path to the file that was not found
     */
    file: string | null;

    constructor(file: string | null = null) {
        super(file ? `File ${file} not found` : "File not found");
        this.file = file;
	}
}

/**
 * Requested directory not found
 */
export class DirectoryNotFoundError extends FileError {
    override name: string = "DirectoryNotFoundError";

    /**
     * Path to the directory that was not found
     */
    directory: string | null;

	constructor(directory: string | null = null) {
        super(directory ? `Directory ${directory} not found` : "Directory not found");
        this.directory = directory;
	}
}

/**
 * Base class for login errors (returned by the connect function)
 */
export class LoginError extends Error {
    override name: string = "LoginError";
}

/**
 * Error thrown when the password is invalid
 */
export class InvalidPasswordError extends LoginError {
    override name: string = "InvalidPasswordError";

    constructor() {
        super("Invalid password");
	}
}

/**
 * Firmware has run out of free sessions
 */
export class NoFreeSessionError extends LoginError {
    constructor() {
        super("No more free sessions");
	}
}

/**
 * Incompatible firmware version/API
 * This error should be quite rare
 */
export class BadVersionError extends LoginError {
    constructor() {
        super("Incompatible firmware version");
	}
}

/**
 * Base class for code errors
 */

export class CodeError extends Error {}

/**
 * Firmware could not store the G-code because it ran out of buffer space
 */
export class CodeBufferError extends CodeError {
    constructor() {
        super("Failed to run code because the firmware ran out of buffer space");
	}
}

/**
 * Code could not be processed because a bad response was received
 */
export class CodeResponseError extends CodeError {
    response: string | number | null;

    constructor(response: string | number | null = null) {
        super((response !== null) ? `Failed to run code because bad response ${response} was received` : "Failed to run code because a bad response was received");
        this.response = response;
	}
}
