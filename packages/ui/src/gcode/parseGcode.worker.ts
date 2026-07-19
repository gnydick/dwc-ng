/**
 * Worker entry point: receives raw gcode text, parses it off the main
 * thread, and posts back the result via transferable buffers (not
 * structured-cloned copies). tsconfig.app.json's lib is ["ES2023", "DOM"]
 * (no "WebWorker") because mixing WebWorker and DOM libs in one program
 * conflicts elsewhere in the app — so `self` is typed here via a local
 * cast instead of the ambient WebWorker globals.
 */
import { parseGcode, type ParsedToolpath } from "./parseGcode.ts";

export type WorkerResponse =
	| { ok: true; toolpath: ParsedToolpath }
	| { ok: false; error: string };

interface WorkerSelf {
	onmessage: ((event: MessageEvent<string>) => void) | null;
	postMessage(message: WorkerResponse, transfer: Transferable[]): void;
}

const ctx = self as unknown as WorkerSelf;

ctx.onmessage = (event: MessageEvent<string>) => {
	try {
		const toolpath = parseGcode(event.data);
		const transfer: Transferable[] = [
			toolpath.positions.buffer,
			toolpath.layerIndex.buffer,
			toolpath.byteOffset.buffer,
			toolpath.extruding.buffer,
			toolpath.deltaE.buffer,
			toolpath.speed.buffer,
			toolpath.featureType.buffer,
			toolpath.layerHeights.buffer,
			toolpath.layerTimeMinutes.buffer,
		];
		ctx.postMessage({ ok: true, toolpath }, transfer);
	} catch (err) {
		ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }, []);
	}
};
