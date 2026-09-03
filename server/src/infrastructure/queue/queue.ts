import { logger } from "../../config/pino.js";

export type JobStatus = "waiting" | "active" | "completed" | "failed" | "dead";
export type JobOptions = {
    jobId?: string; // idempotency key
    attempts?: number; // max retries
    backoffMs?: number;
    delayMs?: number;
};

export interface QueueJob<T = unknown> {
    id: string;
    name: string;
    data: T;
    attemptsMade: number;
    maxAttempts: number;
}

export interface Queue<T = unknown> {
    name: string;
    add(name: string, data: T, opts?: JobOptions): Promise<QueueJob<T>>;
    process(handler: (job: QueueJob<T>) => Promise<void>): void;
    getDeadLetterJobs(): Promise<QueueJob[]>;
}

/**
 * In-memory queue with retry + dead-letter + observability.
 * If REDIS_URL + BullMQ available, this can be swapped with BullMQQueue (same interface).
 */
class InMemoryQueue<T> implements Queue<T> {
    name: string;
    private jobs: QueueJob<T>[] = [];
    private dead: QueueJob<T>[] = [];
    private handler?: (job: QueueJob<T>) => Promise<void>;
    private processing = false;

    // metrics
    public metrics = { enqueued: 0, completed: 0, failed: 0, deadLetter: 0, avgDurationMs: 0 };

    constructor(name: string) {
        this.name = name;
    }

    async add(name: string, data: T, opts: JobOptions = {}): Promise<QueueJob<T>> {
        const id = opts.jobId ?? `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        // idempotency: if job with same id already waiting/active, return existing
        const existing = this.jobs.find((j) => j.id === id);
        if (existing) {
            logger.debug({ queue: this.name, jobId: id }, "duplicate job — idempotent return");
            return existing;
        }
        const job: QueueJob<T> = { id, name, data, attemptsMade: 0, maxAttempts: opts.attempts ?? 3 };
        this.jobs.push(job);
        this.metrics.enqueued++;
        logger.info({ queue: this.name, jobId: id, name }, "job enqueued");

        // also persist to Outbox-like delayed? For durability, caller should have already written OutboxEvent.
        // This queue is durable only via Outbox; in-memory is for processing speed. On crash, Outbox re-enqueues.

        setImmediate(() => this.tick());
        return job;
    }

    process(handler: (job: QueueJob<T>) => Promise<void>): void {
        this.handler = handler;
        this.tick();
    }

    async getDeadLetterJobs(): Promise<QueueJob[]> {
        return [...this.dead];
    }

    private async tick() {
        if (this.processing || !this.handler) return;
        const job = this.jobs.find((j) => true); // FIFO
        if (!job) return;
        this.processing = true;
        const start = Date.now();
        // remove from waiting
        this.jobs = this.jobs.filter((j) => j.id !== job.id);
        try {
            await this.handler!(job);
            this.metrics.completed++;
            const dur = Date.now() - start;
            this.metrics.avgDurationMs = (this.metrics.avgDurationMs + dur) / 2;
            logger.info({ queue: this.name, jobId: job.id, durationMs: dur }, "job completed");
        } catch (err) {
            job.attemptsMade++;
            const isTransient = this.isTransient(err);
            if (job.attemptsMade < job.maxAttempts && isTransient) {
                const backoff = Math.pow(2, job.attemptsMade) * 1000 + Math.random() * 500;
                logger.warn({ queue: this.name, jobId: job.id, attempt: job.attemptsMade, err }, `job failed transient — retry in ${backoff}ms`);
                setTimeout(() => {
                    this.jobs.push(job);
                    this.processing = false;
                    this.tick();
                }, backoff);
                this.processing = false;
                this.metrics.failed++;
                return;
            }
            // permanent or max retries -> dead letter
            this.dead.push({ ...job, attemptsMade: job.attemptsMade });
            this.metrics.deadLetter++;
            this.metrics.failed++;
            logger.error({ queue: this.name, jobId: job.id, err, attempts: job.attemptsMade }, "job dead-lettered");
        } finally {
            this.processing = false;
            if (this.jobs.length) setImmediate(() => this.tick());
        }
    }

    private isTransient(err: unknown): boolean {
        const msg = String((err as Error)?.message ?? "").toLowerCase();
        // Permanent: validation, not found, forbidden
        if (msg.includes("validation") || msg.includes("not found") || msg.includes("forbidden") || msg.includes("invalid")) return false;
        // Transient: timeout, network, 429, provider
        return true;
    }
}

// Queue manager with separate queues per workload (§4)
export class QueueManager {
    private queues = new Map<string, Queue<any>>();

    getQueue<T>(name: string): Queue<T> {
        if (!this.queues.has(name)) {
            this.queues.set(name, new InMemoryQueue<T>(name));
        }
        return this.queues.get(name) as Queue<T>;
    }

    // Predefined queues per spec
    get aiProcessing() { return this.getQueue("ai-processing"); }
    get documentProcessing() { return this.getQueue("document-processing"); }
    get searchIndexing() { return this.getQueue("search-indexing"); }
    get notifications() { return this.getQueue("notifications"); }
    get analytics() { return this.getQueue("analytics"); }
    get memory() { return this.getQueue("memory"); }
    get summary() { return this.getQueue("summary"); }
    get recommendation() { return this.getQueue("recommendation"); }

    getMetrics() {
        const out: Record<string, any> = {};
        for (const [name, q] of this.queues) out[name] = (q as InMemoryQueue<any>).metrics;
        return out;
    }
}

export const queueManager = new QueueManager();
