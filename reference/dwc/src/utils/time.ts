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
