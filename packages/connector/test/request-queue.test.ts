import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestQueue } from "../src/requestQueue.ts";

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

test("runs a task and resolves with its value", async () => {
	const q = new RequestQueue(1);
	assert.equal(await q.enqueue(async () => 42), 42);
});

test("errors propagate and the queue keeps draining", async () => {
	const q = new RequestQueue(1);
	await assert.rejects(() => q.enqueue(async () => { throw new Error("boom"); }));
	assert.equal(await q.enqueue(async () => "still works"), "still works");
});

test("never exceeds the concurrency limit", async () => {
	const q = new RequestQueue(1);
	let running = 0;
	let peak = 0;
	const task = async () => {
		running++; peak = Math.max(peak, running);
		await tick(10);
		running--;
	};
	await Promise.all([q.enqueue(task), q.enqueue(task), q.enqueue(task)]);
	assert.equal(peak, 1, "RRF tolerates very few concurrent requests");
});

test("higher priority jumps the queue ahead of bulk work", async () => {
	const q = new RequestQueue(1);
	const order: string[] = [];
	const task = (name: string) => async () => { order.push(name); await tick(5); };

	// occupy the single slot so the rest genuinely queue
	const blocker = q.enqueue(task("blocker"), "high");
	await tick(1);
	const a = q.enqueue(task("low-1"), "low");
	const b = q.enqueue(task("low-2"), "low");
	const c = q.enqueue(task("poll"), "normal");
	const d = q.enqueue(task("command"), "high");
	await Promise.all([blocker, a, b, c, d]);

	assert.deepEqual(order, ["blocker", "command", "poll", "low-1", "low-2"]);
});

test("FIFO within the same priority", async () => {
	const q = new RequestQueue(1);
	const order: string[] = [];
	const task = (name: string) => async () => { order.push(name); await tick(5); };
	const blocker = q.enqueue(task("blocker"), "normal");
	await tick(1);
	const jobs = ["a", "b", "c"].map(n => q.enqueue(task(n), "normal"));
	await Promise.all([blocker, ...jobs]);
	assert.deepEqual(order, ["blocker", "a", "b", "c"]);
});

test("pending reflects queued work", async () => {
	const q = new RequestQueue(1);
	const blocker = q.enqueue(async () => { await tick(10); });
	await tick(1);
	const queued = q.enqueue(async () => undefined);
	assert.equal(q.pending, 1, "one waiting behind the in-flight task");
	await Promise.all([blocker, queued]);
	assert.equal(q.pending, 0);
});
