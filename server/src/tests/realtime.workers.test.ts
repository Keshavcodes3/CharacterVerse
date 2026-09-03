/**
 * Tests for §11: duplicate jobs, idempotency, ordering, WS reconnect, auth
 * Run with: npx tsx src/tests/realtime.workers.test.ts
 */
import assert from "node:assert";
import { queueManager } from "../infrastructure/queue/queue.js";
import { realtimeManager } from "../realtime/realtime.manager.js";

async function testDuplicateJobsIdempotent() {
    const q = queueManager.getQueue("test-dup");
    let runs = 0;
    q.process(async () => { runs++; });
    await q.add("job", { x: 1 }, { jobId: "dup-1", attempts: 2 });
    await q.add("job", { x: 1 }, { jobId: "dup-1", attempts: 2 }); // duplicate id
    await new Promise(r => setTimeout(r, 200));
    assert(runs === 1, `duplicate job should run once, got ${runs}`);
    console.log("✓ duplicate jobs idempotent");
}

async function testRetryAndDeadLetter() {
    const q = queueManager.getQueue("test-retry");
    let attempts = 0;
    q.process(async () => { attempts++; throw new Error("transient network timeout"); });
    await q.add("fail", {}, { jobId: `fail-${Date.now()}`, attempts: 2 });
    await new Promise(r => setTimeout(r, 5000)); // wait for retries + dead letter
    const dead = await q.getDeadLetterJobs();
    assert(dead.length === 1, "should be dead-lettered after retries");
    console.log("✓ retry + dead-letter");
}

async function testEventOrdering() {
    const userId = "u-order";
    realtimeManager.sendToUser(userId, "msg", { n: 1 }, { conversationId: "c1" });
    realtimeManager.sendToUser(userId, "msg", { n: 2 }, { conversationId: "c1" });
    const missed = realtimeManager.getMissedEvents(userId, 1);
    assert(missed.length === 1 && missed[0].seq === 2, "ordering via seq");
    console.log("✓ event ordering via seq");
}

async function testMultipleConnections() {
    const userId = "u-multi";
    const s1 = { send: () => {}, readyState: 1 } as any;
    const s2 = { send: () => {}, readyState: 1 } as any;
    realtimeManager.register(userId, "s1", s1);
    realtimeManager.register(userId, "s2", s2);
    assert((realtimeManager as any).sockets.get(userId).size === 2, "multiple tabs");
    realtimeManager.unregister(userId, "s1");
    assert((realtimeManager as any).sockets.get(userId).size === 1, "one left");
    realtimeManager.unregister(userId, "s2");
    console.log("✓ multiple connections");
}

async function testIdempotencyKey() {
    // Outbox idempotency: same jobId should not duplicate
    const q = queueManager.getQueue("test-idem");
    let c = 0;
    q.process(async () => { c++; });
    const j1 = await q.add("a", { v: 1 }, { jobId: "idem-xyz" });
    const j2 = await q.add("a", { v: 1 }, { jobId: "idem-xyz" });
    assert(j1.id === j2.id, "idempotent jobId");
    console.log("✓ idempotency via jobId");
}

(async () => {
    console.log("Running realtime/worker tests...");
    await testDuplicateJobsIdempotent();
    await testEventOrdering();
    await testMultipleConnections();
    await testIdempotencyKey();
    await testRetryAndDeadLetter();
    console.log("All realtime/worker tests passed");
})().catch(e => { console.error("fail", e); process.exit(1); });
