import { createMockServer, type MockServerOptions, type MockServer } from "../src/server.ts";

export interface TestMock extends MockServer {
	base: string;
	/** rr_connect and return the session key. */
	connect(password?: string): Promise<number>;
	getJson(path: string, sessionKey?: number): Promise<any>;
	getRaw(path: string, sessionKey?: number): Promise<Response>;
}

/** Start a mock with the simulation timer disabled (tests drive the clock). */
export async function startMock(options: MockServerOptions = {}): Promise<TestMock> {
	const mock = createMockServer({ tickMs: 0, ...options });
	const port = await mock.listen(0);
	const base = `http://127.0.0.1:${port}`;

	const getRaw = (path: string, sessionKey?: number) =>
		fetch(`${base}/${path}`, {
			headers: sessionKey !== undefined ? { "X-Session-Key": String(sessionKey) } : {},
		});

	return {
		...mock,
		base,
		getRaw,
		async getJson(path: string, sessionKey?: number) {
			const res = await getRaw(path, sessionKey);
			if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
			return res.json();
		},
		async connect(password = "") {
			const res = await getRaw(`rr_connect?password=${password}&time=2026-07-12T12:00:00&sessionKey=yes`);
			const body: any = await res.json();
			if (body.err !== 0) throw new Error(`rr_connect err ${body.err}`);
			return body.sessionKey as number;
		},
	};
}

/** Replays the vendored PollConnector's chunk-stitching loop. */
export async function fetchStitched(mock: TestMock, sessionKey: number, key: string, flags: string): Promise<any> {
	let result: any = null;
	let next = 0;
	let requestArray = false;
	do {
		const response = await mock.getJson(
			`rr_model?key=${key}&flags=${flags}${next !== 0 || requestArray ? `a${next}` : ""}`,
			sessionKey,
		);
		next = response.next ?? 0;
		result = Array.isArray(result) ? result.concat(response.result) : response.result;
		requestArray = Array.isArray(result);
	} while (next !== 0);
	return result;
}
