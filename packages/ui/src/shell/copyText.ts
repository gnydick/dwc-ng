/**
 * Copying text to the clipboard, on an appliance served over plain HTTP.
 *
 * ── Why this exists at all. ──────────────────────────────────────────────────
 * navigator.clipboard is [SecureContext]. On any origin that is not HTTPS or
 * localhost it is simply UNDEFINED, so `navigator.clipboard.writeText(...)`
 * throws a TypeError before it can even be awaited. That is not a corner case
 * here: this UI is meant to be served from the Duet's own SD card, and RRF's
 * embedded HTTP server has no TLS. Shipped as-is, copying would be permanently
 * broken on the actual target — and it was already broken for anyone reaching
 * the dev server by LAN name or IP rather than localhost.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * So: try the modern API when it exists, and fall back to the old
 * selection-and-execCommand trick, which still works on insecure origins in
 * every browser this appliance targets. execCommand("copy") is deprecated, not
 * removed, and no standards-track replacement works without a secure context.
 *
 * @invariant copy-failure-is-observable
 * @rung 6  choke-point — this module is the only place in src that touches
 *          navigator.clipboard or execCommand (verified by search, not by
 *          claim), and it returns a boolean rather than void, so a caller
 *          holding the result has to decide what to do with false
 * @why navigator.clipboard is [SecureContext] and simply UNDEFINED on any
 *      origin that is not HTTPS or localhost — which is exactly this appliance,
 *      served from the Duet's SD card over RRF's TLS-less HTTP server. The
 *      previous version swallowed every failure into a bare catch, making a
 *      dead clipboard indistinguishable from a dead click, and the whole
 *      feature was silently broken on the actual target
 * @debt a caller can still ignore the returned boolean. Promote by returning a
 *       result type the caller must narrow before it can carry on, so
 *       "copied, probably" has no encoding.
 */

/**
 * Last-resort copy: put the text in an off-screen textarea, select it, and ask
 * the document to copy the selection.
 *
 * The element must be in the document and actually selectable — display:none or
 * visibility:hidden make the selection empty and the copy silently do nothing —
 * so it is positioned off-screen instead. readOnly keeps a mobile keyboard from
 * appearing during the focus.
 */
function copyViaSelection(text: string): boolean {
	if (typeof document === "undefined") return false;
	const area = document.createElement("textarea");
	area.value = text;
	area.setAttribute("readonly", "");
	area.setAttribute("aria-hidden", "true");
	area.style.position = "fixed";
	area.style.top = "-1000px";
	area.style.left = "-1000px";
	area.style.opacity = "0";
	// Preserve whatever the operator had selected: copying a card tip must not
	// silently destroy a selection they were part-way through making.
	const previous = document.getSelection();
	const restore = previous !== null && previous.rangeCount > 0 ? previous.getRangeAt(0) : null;
	document.body.appendChild(area);
	try {
		area.focus();
		area.select();
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		area.remove();
		if (restore !== null) {
			const selection = document.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(restore);
		}
	}
}

/**
 * Copy `text`, returning true only if it was actually copied.
 *
 * Both paths are attempted: the modern API can exist and still reject (denied
 * permission, a document that is not focused), and falling through to the
 * selection path recovers those cases too.
 */
export async function copyText(text: string): Promise<boolean> {
	// The whole detection sits INSIDE the try, not just the call. On an insecure
	// origin navigator.clipboard is undefined, and merely reading .writeText off
	// it throws synchronously — so a guard written as an expression outside the
	// try would escape as an exception from a click handler rather than being
	// caught. Feature-detection is itself a thing that can fail here.
	try {
		const clipboard = navigator.clipboard as Clipboard | undefined;
		if (clipboard !== undefined && typeof clipboard.writeText === "function") {
			await clipboard.writeText(text);
			return true;
		}
	} catch {
		// Fall through — the old path may still succeed.
	}
	return copyViaSelection(text);
}
