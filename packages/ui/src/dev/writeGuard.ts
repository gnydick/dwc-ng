/**
 * Dev-only guard between the Real-board proxy and the machine.
 *
 * Why this exists: the backend is a dev toggle persisted in localStorage, so a
 * "I'm on the mock" belief can outlive the tab that formed it. On 2026-07-16 a
 * stale belief put a print and a bogus config write onto Gabe's actual printer.
 * Indicators didn't help — nobody reads them. So reads stay free and mutations
 * FAIL CLOSED on the real board unless writes are explicitly armed.
 *
 * This is tooling safety, not machine safety: it never ships to the board (the
 * caller gates it behind import.meta.env.DEV) and it gates nothing on machine
 * state. The firmware remains the only authority over what the machine will do.
 */
import type { Connector } from "../connector/types.ts";

export class RealWriteBlockedError extends Error {
	constructor(what: string) {
		super(
			`Blocked "${what}" — the REAL board is selected and writes are not armed. ` +
			`Switch to Mock, or arm writes deliberately if you mean it.`,
		);
		this.name = "RealWriteBlockedError";
	}
}

/**
 * True only for a bare emergency stop. An e-stop must never be blocked — a
 * guard that swallows M112 is more dangerous than the thing it guards. Kept
 * strict so it can't be used to smuggle other codes through in the same call.
 */
export function isEmergencyStop(code: string): boolean {
	const stripped = code.replace(/;.*$/gm, "").trim();
	return /^m112$/i.test(stripped);
}

export interface GuardOptions {
	/** Is the connector currently pointed at the real board? */
	isReal(): boolean;
	/** Has the operator deliberately armed writes for this session? */
	isArmed(): boolean;
}

/**
 * Wrap a connector so mutating calls fail closed on the real board. Reads
 * (model polling, download, list, fileinfo, thumbnails) always pass.
 */
export function guardWrites(inner: Connector, opts: GuardOptions): Connector {
	const blocked = (what: string): boolean => opts.isReal() && !opts.isArmed();

	return {
		get status() { return inner.status; },
		connect: () => inner.connect(),
		disconnect: () => inner.disconnect(),

		// --- mutations: fail closed on real unless armed ---
		sendCode: async (code: string) => {
			if (!isEmergencyStop(code) && blocked(code)) {
				throw new RealWriteBlockedError(code.split("\n")[0] ?? code);
			}
			return inner.sendCode(code);
		},
		upload: async (path: string, content: Uint8Array | string) => {
			if (blocked(path)) throw new RealWriteBlockedError(`upload ${path}`);
			return inner.upload(path, content);
		},

		// --- reads: always allowed ---
		download: path => inner.download(path),
		list: dir => inner.list(dir),
		getFileInfo: path => inner.getFileInfo(path),
		getThumbnail: (path, offset) => inner.getThumbnail(path, offset),

		switchEndpoint: inner.switchEndpoint
			? (baseUrl, password) => inner.switchEndpoint!(baseUrl, password)
			: undefined,
	};
}
