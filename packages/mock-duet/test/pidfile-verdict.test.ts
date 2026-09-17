/**
 * The kill guard's verdict, over a synthesized machine reading (GIT_210).
 *
 * `identify` takes the machine reading as a PARAMETER, so its logic can be
 * driven without spawning anything — which is the point of this file. The
 * sibling `test/slow/pidfile.test.ts` drives real processes and cannot say
 * "the probe failed" on purpose; nothing here stubs the registry or a process,
 * only the reading itself, and every case below is a reading the machine can
 * actually produce.
 *
 * What is under test: a machine that could not be READ must be distinguishable
 * from a platform that has no way to read it. Both refuse to kill. Only one of
 * them means anything is wrong.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
	failedProbe,
	identify,
	okProbe,
	type PidEntry,
	type Probe,
	probeFailureFrom,
	type ProcInfo,
	probeTrouble,
	type Snapshot,
	stopEntry,
	type Verdict,
	unsupportedProbe,
} from "../src/pidfile.ts";

/** Assert a verdict is unverifiable, and hand back the fields only that kind has. */
function unverifiable(v: Verdict): { reason: string; cause: string } {
	assert.equal(v.kind, "unverifiable");
	if (v.kind !== "unverifiable") throw new Error("unreachable: the assertion above has already failed");
	return { reason: v.reason, cause: v.cause };
}

const PID = 4242;
const PORT = 8173;

/** A pidfile entry naming {@link PID} on {@link PORT}, registered a minute ago. */
function entry(): PidEntry {
	return {
		segment: "main",
		pid: PID,
		port: PORT,
		file: `/nowhere/${PID}`,
		mtimeMs: Date.now() - 60_000,
	};
}

/** A live mock-duet holding that PID, started before the file was written. */
function mockProc(): ProcInfo {
	return {
		pid: PID,
		executable: "node.exe",
		commandLine: `node --title=mock-duet packages/mock-duet/src/cli.ts --port ${PORT}`,
		startedAtMs: Date.now() - 120_000,
	};
}

/** The reading a healthy machine gives for that entry: all three factors hold. */
function healthy(): Snapshot {
	return {
		procs: okProbe(new Map([[PID, mockProc()]])),
		listeners: okProbe(new Map([[PORT, [PID]]])),
	};
}

describe("a machine that could not be read", () => {
	// The positive control for every case below: the SAME entry, with a reading
	// that succeeded, reaches a real verdict. Without this, "unverifiable"
	// everywhere would satisfy each assertion for free.
	test("control: the same entry over a successful reading is `running`", () => {
		assert.equal(identify(entry(), healthy()).kind, "running");
	});

	test("a probe that FAILED is not the same verdict as a platform that cannot probe", () => {
		const failed = identify(entry(), { ...healthy(), procs: failedProbe("Get-CimInstance: the RPC server is unavailable") });
		const unsupported = identify(entry(), { ...healthy(), procs: unsupportedProbe("no `ps` on this platform") });

		// The distinction lives in the DATA, not only in the prose: a caller
		// deciding whether something is wrong reads this field, not a sentence.
		assert.equal(unverifiable(failed).cause, "probe-failed");
		assert.equal(unverifiable(unsupported).cause, "probe-unsupported");
	});

	test("the failure the probe reported reaches the reason an operator reads", () => {
		const verdict = unverifiable(identify(entry(), { ...healthy(), procs: failedProbe("Get-CimInstance: the RPC server is unavailable") }));
		assert.match(verdict.reason, /RPC server is unavailable/);
		// The old text claimed the PLATFORM could not enumerate processes. On a
		// machine that answered the same probe a second earlier, that is false.
		assert.doesNotMatch(verdict.reason, /on this platform/);
	});

	test("a failed LISTENER probe is reported too, not masked by the process probe succeeding", () => {
		const verdict = unverifiable(identify(entry(), { ...healthy(), listeners: failedProbe("Get-NetTCPConnection: catastrophic failure") }));
		assert.equal(verdict.cause, "probe-failed");
		assert.match(verdict.reason, /catastrophic failure/);
	});

	test("an unreadable pidfile is its OWN cause — not blamed on the probe", () => {
		assert.equal(unverifiable(identify({ ...entry(), port: null }, healthy())).cause, "malformed-pidfile");
	});

	test("neither unreadable machine is killable, and neither is forgotten", () => {
		const unreadable: Probe<Map<number, ProcInfo>>[] = [failedProbe("the probe fell over"), unsupportedProbe("nothing to ask")];
		for (const probe of unreadable) {
			const outcome = stopEntry(entry(), { ...healthy(), procs: probe });
			assert.equal(outcome.killed, false, "an unreadable machine can never be killed on");
			assert.equal(outcome.forgotten, false, "and its pidfile is left exactly as it was found");
			assert.match(outcome.detail, /REFUSED/);
		}
	});
});

describe("classifying what a probe actually threw", () => {
	// This is the decision the old bare `catch` never made. A real transient
	// failure and a missing tool arrive here as the same kind of exception
	// object, and only `code` tells them apart.
	test("a missing tool is UNSUPPORTED: there is nothing on this machine to ask", () => {
		const failure = probeFailureFrom("ps", "processes", Object.assign(new Error("spawnSync ps ENOENT"), { code: "ENOENT" }));
		assert.equal(failure.ok, false);
		if (failure.ok) return;
		assert.equal(failure.failure.kind, "unsupported");
		assert.match(failure.failure.reason, /no `ps` on this platform/);
	});

	test("anything else is a FAILED probe, and the error it hit is carried, not discarded", () => {
		const thrown = Object.assign(new Error("Command failed: powershell.exe -NoProfile"), {
			code: "EAGAIN",
			stderr: "Get-CimInstance : The RPC server is unavailable.\nAt line:1 char:1",
		});
		const failure = probeFailureFrom("powershell.exe", "processes", thrown);
		assert.equal(failure.ok, false);
		if (failure.ok) return;
		assert.equal(failure.failure.kind, "failed");
		assert.match(failure.failure.reason, /Command failed/, "the thrown message survives");
		assert.match(failure.failure.reason, /RPC server is unavailable/, "and so does what the tool printed");
		// One line of each: a probe failure is a diagnosis, not a transcript.
		assert.doesNotMatch(failure.failure.reason, /At line:1/);
	});

	test("a throw that is not an Error at all still produces a usable reason", () => {
		const failure = probeFailureFrom("powershell.exe", "listening sockets", "everything is on fire");
		assert.equal(failure.ok, false);
		if (failure.ok) return;
		assert.equal(failure.failure.kind, "failed");
		assert.match(failure.failure.reason, /everything is on fire/);
	});
});

describe("probeTrouble: is this reading usable, and if not, why", () => {
	test("a healthy reading has no trouble to report", () => {
		assert.equal(probeTrouble(healthy()), null);
	});

	// Driven through the REAL constructor rather than a hand-written failure:
	// that is the only way this proves the whole path, from a thrown error to
	// the sentence a caller reads. A hand-built reason would assert nothing
	// about what production actually produces.
	test("it hands back the failing probe's own failure, which names the probe and the error", () => {
		const procs: Probe<Map<number, ProcInfo>> = probeFailureFrom("powershell.exe", "processes", new Error("the RPC server is unavailable"));
		const trouble = probeTrouble({ ...healthy(), procs });
		assert.equal(trouble?.kind, "failed");
		assert.match(trouble?.reason ?? "", /processes/, "it says WHICH probe failed");
		assert.match(trouble?.reason ?? "", /powershell\.exe/, "and what it was asked with");
		assert.match(trouble?.reason ?? "", /RPC server is unavailable/, "and why");
	});

	// The same reading, end to end: a thrown error must reach `identify`'s
	// verdict with its cause and its words intact. Classification and verdict
	// are otherwise only tested apart, which leaves the join untested.
	test("a thrown error reaches the VERDICT with its cause and its words", () => {
		const procs: Probe<Map<number, ProcInfo>> = probeFailureFrom("powershell.exe", "processes", new Error("the RPC server is unavailable"));
		const verdict = unverifiable(identify(entry(), { ...healthy(), procs }));
		assert.equal(verdict.cause, "probe-failed");
		assert.match(verdict.reason, /RPC server is unavailable/);
	});

	test("an unsupported platform is trouble of a different kind, so a caller can retry one and not the other", () => {
		const trouble = probeTrouble({ ...healthy(), listeners: unsupportedProbe("no lsof here") });
		assert.equal(trouble?.kind, "unsupported");
	});
});
