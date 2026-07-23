/**
 * A connector that reaches no machine — the Card Lab renders whole cards
 * against it, and the card studio's live preview mounts inside a provider
 * carrying one, so "a preview cannot send" holds by construction rather
 * than by CSS.
 *
 * Every method is a safe no-op so a card's controls can be clicked without any
 * risk of a real write. sendCode doesn't send: it hands the code to `onSend`,
 * which the lab echoes into a synthetic console, so a control visibly reports
 * the G-code it WOULD emit — useful for checking the 1:1 control→code mapping
 * without a board or even the mock.
 */

import type { Connector, FileListEntry, GcodeFileInfo } from "./types.ts";

export function createStubConnector(onSend: (code: string) => void): Connector {
	return {
		status: "connected",
		async connect() {},
		async disconnect() {},
		async sendCode(code: string): Promise<string> {
			onSend(code);
			return "";
		},
		async upload() {},
		async download(): Promise<string> {
			return "";
		},
		async list(): Promise<FileListEntry[]> {
			return [];
		},
		async mkdir() {},
		async move() {},
		async remove() {},
		async getFileInfo(path: string): Promise<GcodeFileInfo> {
			return { fileName: path, size: 0, filament: [], generatedBy: "card-lab", thumbnails: [] };
		},
		async getThumbnail(): Promise<Uint8Array> {
			return new Uint8Array();
		},
	};
}
