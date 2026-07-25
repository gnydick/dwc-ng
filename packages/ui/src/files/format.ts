/** Display formatters shared across cards and listings — one definition each
 *  (they were duplicated per view before the compose conversion). Kept out of
 *  components so they're unit-testable (node's type-stripping can't load JSX). */

export function formatSize(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${bytes} B`;
}

/** Final path segment — how a file names itself in titles and labels. */
export function baseName(path: string | null | undefined): string {
	if (!path) return "";
	const i = path.lastIndexOf("/");
	return i >= 0 ? path.slice(i + 1) : path;
}

export function fmtDuration(seconds: number): string {
	const s = Math.round(seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s % 60}s`;
	return `${s}s`;
}

/**
 * RRF's file timestamp ("2026-07-21T14:30:00") to "2026-07-21 14:30". Sliced
 * rather than parsed through `new Date()` on purpose: the board reports LOCAL
 * time with no zone, so constructing a Date would shift it by the viewer's
 * offset. A date-only value (no time part) just yields the date.
 */
export function formatModified(date: string | undefined): string {
	if (!date) return "";
	return date.slice(0, 16).replace("T", " ");
}

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * An epoch milliseconds value to "2026-07-21 14:30" in the VIEWER's local time
 * — byte-for-byte the shape formatModified produces, so a timestamp reads
 * identically wherever it appears. No seconds: minute resolution is what a
 * human-paced action needs, and the backup's name is what actually
 * distinguishes two of them.
 *
 * Built from the local getters rather than toISOString(), which renders UTC:
 * that would show the wrong time for anyone off UTC, and near midnight the
 * wrong DATE — the exact thing this function exists to get right.
 *
 * Fixed width by construction (zero-padded throughout). Note that this alone
 * does NOT keep a column aligned: the display font has no tabular-figures
 * feature, so callers rendering a list must reserve the column's width. See
 * .field-label.stamp in app.css.
 */
export function formatTimestamp(ms: number): string {
	const d = new Date(ms);
	if (Number.isNaN(d.getTime())) return "";
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
		+ ` ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
