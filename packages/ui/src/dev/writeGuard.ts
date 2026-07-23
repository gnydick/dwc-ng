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
import type { Connector, ConnectorReads, ConnectorWrites } from "../connector/types.ts";
import { isEmergencyStop } from "../connector/emergency.ts";

export { isEmergencyStop };

export class RealWriteBlockedError extends Error {
	constructor(what: string) {
		super(
			`Blocked "${what}" — the REAL board is selected and writes are not armed. ` +
			`Switch to Mock, or arm writes deliberately if you mean it.`,
		);
		this.name = "RealWriteBlockedError";
	}
}

export interface GuardOptions {
	/** Is the connector currently pointed at the real board? */
	isReal(): boolean;
	/** Has the operator deliberately armed writes for this session? */
	isArmed(): boolean;
}

/**
 * Wrap a connector so mutating calls fail closed on the real board. The
 * read/write classification is the INTERFACE's (ConnectorReads /
 * ConnectorWrites in connector/types.ts, audit M5): the two typed halves
 * below must each be complete for their interface, so a method added to
 * ConnectorWrites fails to compile until it is guarded here — and cannot
 * be smuggled into the pass-through block, which only accepts
 * ConnectorReads members.
 */
export function guardWrites(inner: Connector, opts: GuardOptions): Connector {
	const blocked = (): boolean => opts.isReal() && !opts.isArmed();

	// Mutations: fail closed on real unless armed.
	const writes: ConnectorWrites = {
		sendCode: async (code: string) => {
			if (!isEmergencyStop(code) && blocked()) {
				throw new RealWriteBlockedError(code.split("\n")[0] ?? code);
			}
			return inner.sendCode(code);
		},
		upload: async (path: string, content: Uint8Array | string) => {
			if (blocked()) throw new RealWriteBlockedError(`upload ${path}`);
			return inner.upload(path, content);
		},
		mkdir: async (path: string) => {
			if (blocked()) throw new RealWriteBlockedError(`mkdir ${path}`);
			return inner.mkdir(path);
		},
		move: async (from: string, to: string, overwrite?: boolean) => {
			if (blocked()) throw new RealWriteBlockedError(`move ${from} to ${to}`);
			return inner.move(from, to, overwrite);
		},
		remove: async (path: string, recursive?: boolean) => {
			if (blocked()) throw new RealWriteBlockedError(`delete ${path}`);
			return inner.remove(path, recursive);
		},
	};

	// Reads: always allowed.
	const reads: ConnectorReads = {
		download: path => inner.download(path),
		list: dir => inner.list(dir),
		getFileInfo: path => inner.getFileInfo(path),
		getThumbnail: (path, offset) => inner.getThumbnail(path, offset),
	};

	return {
		get status() { return inner.status; },
		connect: () => inner.connect(),
		disconnect: () => inner.disconnect(),
		...writes,
		...reads,
	};
}
