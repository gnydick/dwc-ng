import { MachineStatus } from "@duet3d/objectmodel";

/**
 * Combine given path elements to a single path
 * @param  {...any} args Path elements
 * @returns Combined path
 */
export function combinePath(...args: any[]) {
	let result = '';
	for (const arg of args) {
		if (arg.startsWith('/') || /(\d)+:.*/.test(arg)) {
			if (arg.endsWith('/')) {
				result = arg.substring(0, arg.length - 1);
			} else {
				result = arg;
			}
		} else {
			if (result !== "") {
				result += '/';
			}
			if (arg.endsWith('/')) {
				result += arg.substring(0, arg.length - 1);
			} else {
				result += arg;
			}
		}
	}
	return result;
}

/**
 * Check if the machine is in a pause-related state
 * @param status Machine status
 * @returns If the machine is paused
 */
export function isPaused(status: MachineStatus) {
	return [MachineStatus.pausing, MachineStatus.paused, MachineStatus.cancelling, MachineStatus.resuming].includes(status);
}

/**
 * Check if the machine is in a print-related state
 * @param status Machine status
 * @returns If the machine is printing
 */
export function isPrinting(status: MachineStatus) {
	return [MachineStatus.pausing, MachineStatus.paused, MachineStatus.cancelling, MachineStatus.resuming, MachineStatus.processing, MachineStatus.simulating].includes(status);
}

/**
 * Convert a datetime to an ISO-like string like "2022-10-10T09:51:00" as local time
 * @param time Time to convert
 * @returns ISO-like datetime string without timezone
 */
export function timeToStr(time: Date) {
	function pad(n: number) {
		return n < 10 ? '0' + n : n;
	}
	let result = "";
	result += time.getFullYear() + "-";
	result += pad(time.getMonth() + 1) + "-";
	result += pad(time.getDate()) + "T";
	result += pad(time.getHours()) + ":";
	result += pad(time.getMinutes()) + ":";
	result += pad(time.getSeconds());
	return result;
}

/**
 * Convert an ISO-like string to datetime.
 * This function is necessary because Date.parse() doesn't always return correct dates
 * @param str String to convert
 * @returns Parsed datetime
 */
export function strToTime(str: string) {
	const results = /(\d+)-(\d+)-(\d+)T(\d+):(\d+):(\d+)/.exec(str);
	if (results !== null) {
		const date = new Date();
		date.setFullYear(parseInt(results[1]));
		date.setMonth(parseInt(results[2]) - 1);
		date.setDate(parseInt(results[3]));
		date.setHours(parseInt(results[4]));
		date.setMinutes(parseInt(results[5]));
		date.setSeconds(parseInt(results[6]));
		return date;
	}
	return null;
}

/**
 * Check if the given object is an AbortSignal
 * @param signal Object to check
 * @returns Whether the object is an AbortSignal
 */
export function isAbortSignal(signal: any): signal is AbortSignal {
	return signal && typeof signal === "object" && "aborted" in signal;
}
