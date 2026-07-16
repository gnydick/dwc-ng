import { Show, createEffect, createMemo, onCleanup } from "solid-js";
import { decodeQoi } from "./qoi.ts";

/**
 * Renders a job thumbnail from raw image bytes. QOI is decoded in-process and
 * painted to a <canvas> (no PNG/JPEG library in the bundle); png/jpeg bytes go
 * through a Blob object URL. `format` comes from the fileinfo thumbnail
 * descriptor. Byte decoding + fetching happen in the connector; this component
 * only presents.
 */
export function Thumbnail(props: { bytes: Uint8Array; format: string; alt: string }) {
	let canvas: HTMLCanvasElement | undefined;

	// QOI: decode to RGBA and blit. Re-runs if bytes/format change.
	createEffect(() => {
		if (props.format !== "qoi" || canvas === undefined) return;
		const img = decodeQoi(props.bytes);
		canvas.width = img.width;
		canvas.height = img.height;
		const ctx = canvas.getContext("2d");
		if (ctx !== null) {
			// Build ImageData then copy in — avoids the TS 5.7 typed-array
			// variance mismatch on passing our buffer to the constructor.
			const id = ctx.createImageData(img.width, img.height);
			id.data.set(img.data);
			ctx.putImageData(id, 0, 0);
		}
	});

	// png/jpeg: a Blob URL, revoked when it changes or the component unmounts.
	const objectUrl = createMemo<string | null>(() => {
		if (props.format === "qoi") return null;
		// Copy into a fresh ArrayBuffer-backed view so it satisfies BlobPart.
		const url = URL.createObjectURL(new Blob([new Uint8Array(props.bytes)], { type: `image/${props.format}` }));
		onCleanup(() => URL.revokeObjectURL(url));
		return url;
	});

	return (
		<Show
			when={props.format === "qoi"}
			fallback={<img class="thumb-img" src={objectUrl() ?? ""} alt={props.alt} />}
		>
			<canvas class="thumb-img" ref={canvas} role="img" aria-label={props.alt} />
		</Show>
	);
}
