/**
 * The DSF diff applier — the ONLY place DSF merge semantics exist (design
 * doc D1, invariant C2). Pure: no I/O, no Solid, no timers. The DSF
 * connector owns one instance, feeds it raw /machine frames, and emits
 * from the digest — wholesale onModelKey per touched key, so the store's
 * un-conformed patch path is unreachable from this transport.
 *
 * The merge semantics (behavior learned from the vendored
 * @duet3d/objectmodel update() model, reference/objectmodel/src/
 * ModelObject.ts — this implementation is fresh, per the reference-only
 * rule):
 * - a key absent from a patch is unchanged;
 * - null replaces the whole subtree;
 * - an object merges recursively over its PRESENT keys only;
 * - an array is FULL-LENGTH authority: shorter truncates, longer appends,
 *   and an object element may itself be a partial diff merged in place —
 *   truncation is exactly what the store's grow-only live-patch path
 *   cannot express, hence this module;
 * - anything else replaces.
 *
 * Channel extraction happens BEFORE any merge, at the one ingestion seam:
 * - `messages` is a consumed reply channel (D3/C5) — formatted onto the
 *   digest; the copy pins `messages: []` from birth. Deep-merging it
 *   would repeat console lines forever.
 * - `job.layers` travels only via the digest's layers field (D2/C4) —
 *   the copy's job structurally never holds layers (they live in a
 *   private side slot), so a job snapshot cannot leak them.
 * - `seqs` is standalone-only protocol state — inert if a server sends it.
 *
 * Boundary hygiene (C3): wire objects are iterated only via safeEntries,
 * and every stored subtree is rebuilt by sanitize(), so a
 * prototype-reaching key anywhere in a frame is dead on arrival and the
 * private copy is clean plain data at every depth. Snapshots and digest
 * layers are independent deep clones — the caller owns them; later merges
 * cannot reach them, and mutating them cannot reach the copy.
 */
import { isPlainObject, safeEntries } from "../util/safeObject.ts";

export interface DsfDigest {
	/**
	 * Top-level model keys whose subtree actually changed, in wire order —
	 * the connector emits onModelKey(key, snapshot(key)) for each. A diff
	 * that changes nothing produces none (no phantom emissions).
	 */
	touchedKeys: string[];
	/**
	 * Non-null when the layer history changed — emit via onJobLayers.
	 * [] is meaningful (a new print's shrink-to-empty resets the store);
	 * null means "unchanged, emit nothing".
	 */
	layers: unknown[] | null;
	/** Console lines from the frame's messages channel — emit via onReply. */
	replies: string[];
}

export interface DsfModel {
	/** Replace the copy wholesale from a first/reconnect frame (C8 upstream);
	 *  layers is always non-null — a reconnect re-asserts layer truth. */
	applyFull(raw: unknown): DsfDigest;
	/** Merge one DSF patch into the copy. */
	applyDiff(raw: unknown): DsfDigest;
	/**
	 * The emission value for a touched key: an independent deep clone.
	 * `snapshot("job")` carries `layers: []` ALWAYS (C4 — layers travel
	 * only on the layers channel). Absent keys yield undefined.
	 */
	snapshot(key: string): unknown;
}

/** MessageType wire values: 0 success, 1 warning, 2 error
 *  (reference/objectmodel/src/messages/index.ts:3). Formatted to RRF's own
 *  text convention so consoleLog's classifier needs no second dialect. */
function collectReplies(value: unknown, out: string[]): void {
	if (!Array.isArray(value)) return;
	for (const entry of value) {
		if (!isPlainObject(entry)) continue;
		const content = entry["content"];
		if (typeof content !== "string" || content === "") continue;
		const type = entry["type"];
		const prefix =
			type === 2 || type === "error" ? "Error: "
			: type === 1 || type === "warning" ? "Warning: "
			: "";
		out.push(prefix + content);
	}
}

/**
 * Deep clone of a wire value with the prototype-reaching keys dropped at
 * every depth — the one walker for both directions: hostile wire data in
 * (the copy only ever stores its output) and trusted copy data out
 * (snapshots/digests are its output too, so they are independent clones).
 */
function sanitize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(item => sanitize(item));
	if (isPlainObject(value)) {
		const out: Record<string, unknown> = {};
		for (const [key, child] of safeEntries(value)) out[key] = sanitize(child);
		return out;
	}
	return value;
}

interface Merged {
	value: unknown;
	changed: boolean;
}

/**
 * The recursive merge kernel — DSF semantics live here and nowhere else.
 * Mutates plain-object/array `existing` in place where the shapes line up;
 * anything newly stored passes through sanitize(). `changed` is exact for
 * merges (a value written equal to itself does not count) and true for
 * every wholesale replacement.
 */
function mergeValue(existing: unknown, patch: unknown): Merged {
	if (patch === null) return { value: null, changed: existing !== null };
	if (Array.isArray(patch)) {
		if (!Array.isArray(existing)) return { value: sanitize(patch), changed: true };
		let changed = false;
		if (existing.length > patch.length) {
			// Full-length authority: a shorter patch array truncates.
			existing.length = patch.length;
			changed = true;
		}
		for (let i = 0; i < patch.length; i++) {
			if (i < existing.length) {
				const merged = mergeValue(existing[i], patch[i]);
				if (merged.changed) {
					existing[i] = merged.value;
					changed = true;
				}
			} else {
				existing.push(sanitize(patch[i]));
				changed = true;
			}
		}
		return { value: existing, changed };
	}
	if (isPlainObject(patch)) {
		if (!isPlainObject(existing)) return { value: sanitize(patch), changed: true };
		return { value: existing, changed: mergeObjectInto(existing, patch) };
	}
	return { value: patch, changed: existing !== patch };
}

/**
 * The one object-merge loop (patch keys PRESENT merge into target; safe
 * iteration). The seams reuse it with hooks instead of re-implementing it:
 * `route` consumes a key before any merge (channel extraction — messages,
 * seqs, job.layers); `onMerged` observes per-key change (touched-key
 * tracking). Routed keys never count toward `changed`.
 */
function mergeObjectInto(
	target: Record<string, unknown>,
	patch: Record<string, unknown>,
	route?: (key: string, value: unknown) => boolean,
	onMerged?: (key: string, changed: boolean) => void,
): boolean {
	let changed = false;
	for (const [key, value] of safeEntries(patch)) {
		if (route !== undefined && route(key, value)) continue;
		const merged = mergeValue(target[key], value);
		if (merged.changed) {
			target[key] = merged.value;
			changed = true;
		}
		onMerged?.(key, merged.changed);
	}
	return changed;
}

export function createDsfModel(): DsfModel {
	// The sole copy constructor: messages exists pinned [] from birth (C5)
	// and nothing else ever writes it — the ingestion route consumes the
	// key before the merge can see it.
	const freshCopy = (): Record<string, unknown> => ({ messages: [] });
	let copy = freshCopy();
	// The layers side slot (C4): job's layers are re-routed here at
	// ingestion, so the copy's job cannot hold them — there is no state in
	// which a job snapshot could leak layer data.
	let layersStore: unknown[] = [];

	const cloneLayers = (): unknown[] => layersStore.map(item => sanitize(item));

	/** Merge a patch's job.layers into the side slot; true when it changed. */
	const mergeLayers = (patchVal: unknown): boolean => {
		const merged = mergeValue(layersStore, patchVal);
		if (!merged.changed) return false;
		if (Array.isArray(merged.value)) {
			layersStore = merged.value;
			return true;
		}
		// Degenerate wire (layers: null / primitive): the channel value is
		// always an array — reset, and only a real transition counts.
		const hadLayers = layersStore.length > 0;
		layersStore = [];
		return hadLayers;
	};

	/**
	 * The job key's seam: layers are split off BEFORE the merge so they can
	 * never land in the copy. `changed` excludes layers-only diffs — the
	 * job emission would be identical, and the layers channel already
	 * carries the change.
	 */
	const applyJob = (patchVal: unknown): { changed: boolean; layersTouched: boolean } => {
		const existing = copy["job"];
		if (isPlainObject(patchVal) && isPlainObject(existing)) {
			let layersTouched = false;
			const changed = mergeObjectInto(existing, patchVal, (key, value) => {
				if (key !== "layers") return false;
				layersTouched = mergeLayers(value);
				return true;
			});
			return { changed, layersTouched };
		}
		// Wholesale replacement (null / first sight / shape change): the
		// layer history is replaced along with it, so the channel fires.
		const merged = mergeValue(existing, patchVal);
		if (!merged.changed) return { changed: false, layersTouched: false };
		let nextLayers: unknown[] = [];
		if (isPlainObject(merged.value)) {
			const cleanJob = merged.value as Record<string, unknown>;
			if (Array.isArray(cleanJob["layers"])) nextLayers = cleanJob["layers"] as unknown[];
			delete cleanJob["layers"];
		}
		copy["job"] = merged.value;
		layersStore = nextLayers;
		return { changed: true, layersTouched: true };
	};

	/** The one ingestion seam — both apply paths funnel through it, so the
	 *  channel extraction (messages/seqs/layers) cannot be skipped. */
	const ingest = (raw: unknown): DsfDigest => {
		const touchedKeys: string[] = [];
		const replies: string[] = [];
		let layers: unknown[] | null = null;
		if (isPlainObject(raw)) {
			mergeObjectInto(
				copy,
				raw,
				(key, value) => {
					if (key === "messages") {
						collectReplies(value, replies);
						return true;
					}
					if (key === "seqs") return true;
					if (key === "job") {
						const job = applyJob(value);
						if (job.changed) touchedKeys.push("job");
						if (job.layersTouched) layers = cloneLayers();
						return true;
					}
					return false;
				},
				(key, changed) => {
					if (changed) touchedKeys.push(key);
				},
			);
		}
		return { touchedKeys, layers, replies };
	};

	return {
		applyFull(raw) {
			// Wholesale: no partial-resume state can exist (C8). A key the
			// new frame lacks simply stops existing in the copy; emission
			// covers exactly what the frame asserted.
			copy = freshCopy();
			layersStore = [];
			const digest = ingest(raw);
			// A (re)connect re-asserts layer truth unconditionally — [] when
			// the frame carried none, so a stale history cannot survive.
			return { touchedKeys: digest.touchedKeys, layers: cloneLayers(), replies: digest.replies };
		},
		applyDiff(raw) {
			return ingest(raw);
		},
		snapshot(key) {
			// Object.hasOwn: absent keys yield undefined without ever reading
			// through the prototype chain ("__proto__", "toString", …).
			if (!Object.hasOwn(copy, key)) return undefined;
			const value = copy[key];
			if (key === "job" && isPlainObject(value)) {
				// C4: a job emission ALWAYS carries layers: [] — the store's
				// preservation rule keeps its current history until the
				// layers channel speaks.
				return { ...(sanitize(value) as Record<string, unknown>), layers: [] };
			}
			return sanitize(value);
		},
	};
}
