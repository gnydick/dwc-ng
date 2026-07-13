import { readFileSync } from "node:fs";
import { createBaseModel, POLLED_KEYS, type Om } from "./snapshot.ts";

/**
 * Load a captured object model over the synthetic base model.
 *
 * The capture is a full OM tree as returned by DSF's `GET /machine/model`
 * (SBC mode) or stitched from `rr_model?key=<key>&flags=d99vno` responses
 * (standalone). Only the keys a standalone client polls are taken from the
 * capture — DSF-only root keys (`sbc`, `plugins`) and `messages` are dropped,
 * because standalone RRF never serves them (see the rrf-object-model skill).
 *
 * `seqs` never comes from a capture: it is not part of the OM (it exists only
 * in the `rr_model` wire protocol, standalone-only) and SBC captures don't
 * have it at all. The Machine owns and synthesizes all seqs counters.
 *
 * Caveat: replacement is per whole subtree, so DSF-maintained *nested* fields
 * inside polled keys survive verbatim. That makes the mock a slight superset
 * of a real standalone board — fine for driving the UI, but don't treat field
 * presence in the mock as proof it exists on real standalone hardware.
 */
export function loadCaptureModel(capture: Om): Om {
	const model = createBaseModel();
	for (const key of POLLED_KEYS) {
		if (capture[key] !== undefined && capture[key] !== null) {
			model[key] = structuredClone(capture[key]);
		}
	}
	return model;
}

/** Read and load a capture file (JSON as saved from `GET /machine/model`). */
export function loadCaptureFile(path: string | URL): Om {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		throw new Error(`Cannot read capture file ${path}: ${(err as Error).message}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`Capture file ${path} is not an object model (expected a JSON object)`);
	}
	return loadCaptureModel(parsed as Om);
}
