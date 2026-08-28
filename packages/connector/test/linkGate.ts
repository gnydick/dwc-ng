import net from "node:net";

/**
 * A TCP pass-through in front of mock-duet whose LINK can be broken, in the
 * two ways a link actually breaks.
 *
 * `cut()` is the abrupt drop: every connection, in flight or newly offered, is
 * destroyed. A client learns immediately that it has no link.
 *
 * `blackhole()` is the nastier one, and the one requirement 2 is really about:
 * connections stay OPEN and simply stop carrying bytes, so nothing ever fails —
 * a request into it hangs until whatever budget the caller gave it, and a
 * request given no budget hangs forever. This is the shape a WiFi drop, a
 * suspended laptop, or a firewall silently dropping packets takes.
 *
 * TCP rather than an HTTP proxy so it is transport-agnostic: the same gate
 * breaks rr_ requests and a DSF WebSocket, and the DSF half of GIT_110 needs
 * both broken at once. A `machine.requestOutage` cannot stand in for it — an
 * outage CLEARS the mock's sessions, which is a board reboot rather than a lost
 * link, and it would tidy away the very orphans these tests are about.
 */
export interface LinkGate {
	listen(): Promise<number>;
	/** Abrupt drop: existing connections die, new ones are refused silently. */
	cut(): void;
	/** Silent drop: connections stay open and carry nothing, forever. */
	blackhole(): void;
	restore(): void;
	/** Connections offered since listen(), broken ones included. A ladder that
	 *  is retrying rather than blocked shows up here while the link is down. */
	attempts(): number;
	close(): Promise<void>;
}

export function createLinkGate(targetPort: number, host = "127.0.0.1"): LinkGate {
	let state: "live" | "cut" | "blackhole" = "live";
	let attempts = 0;
	const open = new Set<net.Socket>();
	const server = net.createServer(client => {
		attempts++;
		open.add(client);
		client.on("close", () => open.delete(client));
		if (state === "cut") {
			client.destroy();
			return;
		}
		if (state === "blackhole") {
			// Accepted, and that is all: no upstream, no reply, no close.
			client.on("error", () => undefined);
			return;
		}
		const upstream = net.connect(targetPort, host);
		open.add(upstream);
		for (const socket of [client, upstream]) {
			socket.on("error", () => { client.destroy(); upstream.destroy(); });
			socket.on("close", () => {
				open.delete(socket);
				if (state !== "blackhole") {
					client.destroy();
					upstream.destroy();
				}
			});
		}
		client.pipe(upstream);
		upstream.pipe(client);
	});
	return {
		listen: () => new Promise<number>(resolve => server.listen(0, host, () => {
			resolve((server.address() as net.AddressInfo).port);
		})),
		cut() {
			state = "cut";
			for (const socket of [...open]) socket.destroy();
		},
		blackhole() {
			state = "blackhole";
			// Unpiped, not destroyed: the sockets stay up and stop carrying.
			for (const socket of [...open]) socket.unpipe();
		},
		restore() {
			// Whatever survived the break is stale — a half-spoken HTTP request
			// on either side of it. Drop them and serve fresh connections.
			const stale = [...open];
			state = "live";
			for (const socket of stale) socket.destroy();
		},
		attempts: () => attempts,
		close: () => new Promise<void>(resolve => {
			state = "cut";
			for (const socket of [...open]) socket.destroy();
			server.close(() => resolve());
		}),
	};
}
