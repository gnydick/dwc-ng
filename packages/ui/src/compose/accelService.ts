/**
 * The accelerometer's own service: which sensor a tool is addressed at, what
 * rate and resolution it is running, and the two codes that ask and set.
 *
 * SPLIT OUT OF THE SHAPING SERVICE (#126), and the split is along the eager /
 * lazy line rather than along a feature line. Two cards use these four
 * members, and they live on opposite sides of the dynamic boundary:
 *
 *  - Settings › Input shaping (`cards/SettingsCards.tsx`) is deliberately
 *    EAGER — it is small and lives on a screen the operator uses constantly;
 *  - the Shaping Lab's Capture card is behind `import()` with the rest of the
 *    Lab.
 *
 * While these four hung off the Lab's service, the eager card reaching for a
 * sample rate pulled the whole Lab — 23 modules, 21,635 B — onto the critical
 * path of every cold load. They are their own registry entry now, so the eager
 * card reaches `ctx.service("accel")` and nothing else, and the Lab reaches the
 * SAME instance through the same pool rather than building a second one.
 *
 * ONE instance per screen, like every service: `createServicePool` memoizes on
 * first access, so the Capture card and the Settings card on one screen cannot
 * see two different ideas of what the sensor reported.
 *
 * Nothing here decides anything. `M955 P<addr>` REPORTS; the board is the
 * authority on what it actually selected and this asks it.
 *
 * IN compose/ AND NOT shaping/, deliberately. `test/shaping-motion-fence.test.ts`
 * keeps `sendCode(` inside `procedure.ts` for everything under `src/shaping/`,
 * because that screen moves the carriage for its own reasons. These two codes
 * are M955 — they configure a sensor and move nothing — and they lived in
 * `compose/services.ts`, outside that zone, before this split. Putting the file
 * here keeps that exactly as it was; putting it in `src/shaping/` and adding an
 * allowlist entry would widen a motion fence to relocate code, which is a worse
 * trade than a file living beside the other services.
 */
import { createStore } from "solid-js/store";
import { cmd, parseAccelAddr } from "../control/commands.ts";
import { type AccelReport, parseAccelReport } from "../shaping/accelReport.ts";
import type { ServiceBaseCtx } from "./services.ts";

/**
 * The tool's accelerometer, as the M955/M956 builders address one, or null
 * when config names none for it.
 *
 * `parseAccelAddr` and not a cast: the overlay is untrusted text, and the
 * address brand has exactly one minting site (control/commands.ts) so that a
 * capture cannot be aimed at a board nobody chose.
 *
 * A free function over the config rather than a member, because the Lab's own
 * gate needs the same answer and a second `parseAccelAddr` call at that call
 * site would be the tripwire: one address derivation, two readers.
 */
export const accelAddrFor = (base: ServiceBaseCtx, n: number): ReturnType<typeof parseAccelAddr> =>
	parseAccelAddr(base.config.config.shaping.accelByTool[n] ?? "");

export function createAccelService(base: ServiceBaseCtx) {
	/** What the accelerometer reported last time it was asked, per tool. */
	const [accelReports, setAccelReports] = createStore<Record<number, AccelReport>>({});
	const accelReportFor = (n: number): AccelReport | null => accelReports[n] ?? null;

	const accelFor = (n: number): ReturnType<typeof parseAccelAddr> => accelAddrFor(base, n);

	/**
	 * Ask an accelerometer what rate and resolution it is running.
	 *
	 * `M955` with P alone REPORTS; it is the only way to find out, because the
	 * object model does not carry the rate — `boards[n].accelerometer` is
	 * orientation, points and runs and nothing else.
	 */
	const readAccel = async (n: number): Promise<void> => {
		const addr = accelFor(n);
		if (addr === null) return;
		try {
			setAccelReports(n, parseAccelReport(await base.connector.sendCode(cmd.accelConfig(addr))));
		} catch (err) {
			setAccelReports(n, { known: false, raw: err instanceof Error ? err.message : String(err) });
		}
	};

	/**
	 * Set the rate and resolution, then ASK what was actually selected.
	 *
	 * The read-back is not a nicety, it is the only truthful answer. RRF
	 * adjusts the resolution to be no greater than R and then picks "a value
	 * supported at that resolution that is close to" S — so what the operator
	 * typed and what the sensor is doing are routinely different numbers. An
	 * LIS3DH asked for 5376 at 10-bit does not get it.
	 *
	 * Which is also why nothing here predicts or validates the pair against a
	 * table of sensors. The board knows; this asks it.
	 */
	const setAccelRate = async (n: number, sampleRateHz: number, bits: number): Promise<void> => {
		const addr = accelFor(n);
		if (addr === null) return;
		try {
			await base.connector.sendCode(cmd.accelRate(addr, sampleRateHz, bits));
		} catch (err) {
			setAccelReports(n, { known: false, raw: err instanceof Error ? err.message : String(err) });
			return;
		}
		await readAccel(n);
	};

	return { accelFor, accelReportFor, readAccel, setAccelRate };
}
