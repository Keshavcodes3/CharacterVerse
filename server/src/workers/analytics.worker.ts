import { logger } from "../config/pino.js";
import { queueManager } from "../infrastructure/queue/queue.js";
import { prisma } from "../infrastructure/database/db.js";

export type AnalyticsJob = { eventType: string; aggregateId: string; payload: unknown; createdAt: string };

async function handleAnalytics(job: { data: AnalyticsJob }) {
    // Idempotent analytics ingestion — dedup by eventId if needed
    logger.info({ eventType: job.data.eventType, aggregateId: job.data.aggregateId }, "analytics event processed");
    // Example: increment daily counters, could write to analytics table
    // For now just log and optionally persist to a generic table
}

export function startAnalyticsWorker() {
    queueManager.analytics.process(async (job) => handleAnalytics(job as any));
    logger.info("Analytics worker started (queue: analytics)");
}

export async function enqueueAnalytics(data: AnalyticsJob) {
    return queueManager.analytics.add("analytics", data, { jobId: `analytics-${data.eventType}-${data.aggregateId}-${Date.now()}`, attempts: 2 });
}
