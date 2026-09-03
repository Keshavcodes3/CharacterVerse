import { queueManager } from "../queue/queue.js";
import { realtimeManager } from "../../realtime/realtime.manager.js";

type Metric = { value: number; labels?: Record<string, string> };

class MetricsRegistry {
    queueLatency: Metric[] = [];
    jobDuration: Map<string, number[]> = new Map();
    retryCount = new Map<string, number>();
    deadLetterCount = 0;
    wsConnections = 0;
    generationLatency: number[] = [];
    ttfb: number[] = [];

    recordQueueLatency(queue: string, latencyMs: number) {
        this.queueLatency.push({ value: latencyMs, labels: { queue } });
        if (this.queueLatency.length > 1000) this.queueLatency.shift();
    }

    recordJobDuration(queue: string, durationMs: number) {
        if (!this.jobDuration.has(queue)) this.jobDuration.set(queue, []);
        const arr = this.jobDuration.get(queue)!;
        arr.push(durationMs);
        if (arr.length > 200) arr.shift();
    }

    recordRetry(queue: string) {
        this.retryCount.set(queue, (this.retryCount.get(queue) ?? 0) + 1);
    }

    recordDeadLetter() { this.deadLetterCount++; }

    recordWsConnections(n: number) { this.wsConnections = n; }

    recordGeneration(latencyMs: number, ttfbMs?: number) {
        this.generationLatency.push(latencyMs);
        if (ttfbMs !== undefined) this.ttfb.push(ttfbMs);
        if (this.generationLatency.length > 500) this.generationLatency.shift();
        if (this.ttfb.length > 500) this.ttfb.shift();
    }

    snapshot() {
        const queues = queueManager.getMetrics();
        const ws = realtimeManager.getMetrics();
        const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        return {
            queues,
            ws,
            generation: {
                avgLatencyMs: avg(this.generationLatency),
                avgTTFBms: avg(this.ttfb),
                p95Latency: this.percentile(this.generationLatency, 95),
                count: this.generationLatency.length,
            },
            deadLetters: this.deadLetterCount,
            timestamp: new Date().toISOString(),
        };
    }

    private percentile(arr: number[], p: number) {
        if (!arr.length) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const idx = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, idx)];
    }
}

export const metrics = new MetricsRegistry();
