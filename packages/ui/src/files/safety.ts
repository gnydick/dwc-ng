/**
 * Data-loss guards for file operations.
 *
 * These are deliberately NOT machine-logic safeties: nothing here decides what
 * the machine may do, gates on machine state, or forms an opinion the firmware
 * hasn't. They only slow down deletions that cannot be undone from this UI —
 * a recursive directory delete, or a file whose loss leaves the machine (or
 * this UI) unconfigured. The firmware remains the authority over behaviour.
 */

/**
 * Files whose deletion is unrecoverable from here. Kept short on purpose: this
 * is not a curated list of "important" files, only the ones whose loss cannot
 * be repaired through this UI afterwards.
 */
export const PROTECTED_BASENAMES: Readonly<Record<string, string>> = {
	"config.g": "the machine's entire configuration — the board boots unconfigured without it",
	"config-override.g": "saved calibration (M500 output) — tuning is lost without it",
	"dwc-ng-config.json": "this UI's own configuration — axis roles, sensor names, layouts",
};

/**
 * Why deleting `path` is unrecoverable, or null when it is an ordinary file.
 * Matched on the exact basename, case-insensitively: RRF's filesystem is
 * case-insensitive, so CONFIG.G is the same file, while config.g.bak is not.
 */
export function protectedReason(path: string): string | null {
	const basename = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
	return PROTECTED_BASENAMES[basename] ?? null;
}
