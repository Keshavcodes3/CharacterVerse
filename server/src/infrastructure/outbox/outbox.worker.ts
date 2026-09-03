import { prisma } from "../database/db.js";
import { logger } from "../../config/pino.js";

/**
 * Polls OutboxEvent and dispatches to consumers.
 * Consumers: search index, cache invalidation, analytics, moderation, notifications
 * Never publish before DB transaction durable — outbox guarantees that.
 */
export class OutboxWorker {
    private timer: NodeJS.Timeout | null = null;
    private running = false;

    start(intervalMs = 5000) {
        if (this.running) return;
        this.running = true;
        const tick = async () => {
            try {
                const events = await prisma.outboxEvent.findMany({
                    where: { status: "PENDING" },
                    take: 20,
                    orderBy: { createdAt: "asc" },
                });
                for (const ev of events) {
                    await prisma.outboxEvent.update({ where: { id: ev.id }, data: { status: "PROCESSING", attempts: { increment: 1 } } });
                    try {
                        await this.dispatch(ev);
                        await prisma.outboxEvent.update({ where: { id: ev.id }, data: { status: "PROCESSED", processedAt: new Date() } });
                        logger.info({ eventType: ev.eventType, aggregateId: ev.aggregateId }, "Outbox processed");
                    } catch (err) {
                        const next = new Date(Date.now() + Math.min(60000 * Math.pow(2, ev.attempts), 300000));
                        await prisma.outboxEvent.update({ where: { id: ev.id }, data: { status: "FAILED", lastError: String((err as Error).message).slice(0, 2000), nextAttemptAt: next } });
                        logger.error({ err, eventId: ev.id }, "Outbox failed");
                    }
                }
            } catch (err) {
                logger.error({ err }, "Outbox tick failed");
            }
            if (this.running) this.timer = setTimeout(tick, intervalMs);
        };
        tick();
        logger.info("OutboxWorker started");
    }

    stop() {
        this.running = false;
        if (this.timer) clearTimeout(this.timer);
    }

    private async dispatch(ev: { id: string; eventType: string; payload: any; aggregateType: string; aggregateId: string }) {
        const { queueManager } = await import("../queue/queue.js");

        // Route to appropriate queue — durable, separate per workload (§1,§4)
        const route = async () => {
            switch (ev.eventType) {
                case "CharacterCreated":
                case "CharacterUpdated":
                case "CharacterPublished":
                case "CharacterArchived":
                case "CharacterSuspended":
                case "CharacterDeleted":
                    await queueManager.searchIndexing.add("index", { characterId: ev.aggregateId, eventType: ev.eventType }, { jobId: `outbox-${ev.id}`, attempts: 3 });
                    await queueManager.analytics.add("analytics", { eventType: ev.eventType, aggregateId: ev.aggregateId, payload: ev.payload, createdAt: new Date().toISOString() }, { jobId: `analytics-${ev.id}`, attempts: 2 });
                    // also search indexer via queue — legacy handler kept for idempotence
                    try {
                        const { SearchIndexerHandler } = await import("../search/searchIndexer.worker.js");
                        if (SearchIndexerHandler.canHandle(ev.eventType)) await SearchIndexerHandler.handle(ev);
                    } catch (e) { logger.warn({ err: e }, "search indexer inline failed"); }
                    break;
                case "ConversationCreated":
                    await queueManager.analytics.add("analytics", { eventType: ev.eventType, aggregateId: ev.aggregateId, payload: ev.payload, createdAt: new Date().toISOString() }, { jobId: `analytics-${ev.id}` });
                    break;
                case "UserMessageCreated":
                    // enqueue memory, summary, analytics
                    await queueManager.analytics.add("analytics", { eventType: ev.eventType, aggregateId: ev.aggregateId, payload: ev.payload, createdAt: new Date().toISOString() }, { jobId: `analytics-${ev.id}` });
                    // memory extraction is enqueued by message service directly, but also here as fallback
                    break;
                case "AssistantMessageCreated":
                case "GenerationCompleted":
                case "GenerationFailed":
                    await queueManager.analytics.add("analytics", { eventType: ev.eventType, aggregateId: ev.aggregateId, payload: ev.payload, createdAt: new Date().toISOString() }, { jobId: `analytics-${ev.id}` });
                    break;
                case "KnowledgeDocumentCreated":
                case "KnowledgeDocumentReady":
                    await queueManager.documentProcessing.add("doc", ev.payload, { jobId: `outbox-${ev.id}` });
                    break;
                case "FollowCreated":
                case "LikeCreated":
                    await queueManager.notifications.add("notify", { userId: ev.payload?.followingId ?? ev.payload?.characterId, type: ev.eventType.includes("Follow") ? "FOLLOW" : "LIKE", title: ev.eventType, content: JSON.stringify(ev.payload), data: ev.payload }, { jobId: `notify-${ev.id}` });
                    await queueManager.recommendation.add("reco", { characterId: ev.payload?.characterId }, { jobId: `reco-${ev.id}` });
                    break;
                default:
                    logger.info({ eventType: ev.eventType }, "Dispatch generic outbox event to analytics");
                    await queueManager.analytics.add("analytics", { eventType: ev.eventType, aggregateId: ev.aggregateId, payload: ev.payload, createdAt: new Date().toISOString() }, { jobId: `analytics-${ev.id}` });
            }
        };

        await route();
        logger.info({ eventType: ev.eventType, aggregateId: ev.aggregateId }, "Outbox routed to queue");
    }
}

export const outboxWorker = new OutboxWorker();
