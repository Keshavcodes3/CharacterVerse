import { prisma } from "../infrastructure/database/db.js";
import { logger } from "../config/pino.js";
import { knowledgeService } from "../modules/knowledge/knowledge.service.js";

/**
 * Async ingestion worker per spec §8
 * - idempotent: READY/DELETED docs are skipped
 * - retryable: FAILED with attempts <3 requeued with backoff
 * - polls DB (or BullMQ in prod)
 */
let timer: NodeJS.Timeout | null = null;
let running = false;

export async function processDocument(documentId: string) {
    // delegating to service ensures same pipeline
    return knowledgeService.processDocumentIngestion(documentId);
}

async function poll() {
    if (!running) return;
    try {
        const jobs = await prisma.ingestionJob.findMany({
            where: {
                status: { in: ["PENDING", "FAILED"] } as never,
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
            },
            take: 5,
            orderBy: { createdAt: "asc" },
        });

        for (const job of jobs) {
            try {
                await processDocument(job.documentId);
            } catch (err) {
                logger.warn({ err, documentId: job.documentId, attempts: job.attempts }, "Ingestion job failed");
                // error handling inside processDocumentIngestion already updates job; just log
            }
        }

        // cleanup DELETED docs vectors (async cleanup per spec §9)
        const deleted = await prisma.knowledgeDocument.findMany({ where: { status: "DELETED" as never }, take: 5, select: { id: true, knowledgeBaseId: true, characterId: true } });
        for (const d of deleted) {
            try {
                await prisma.knowledgeChunk.deleteMany({ where: { documentId: d.id } });
                await prisma.knowledgeDocument.delete({ where: { id: d.id } });
                logger.info({ documentId: d.id }, "Deleted document cleaned up");
            } catch (e) {
                logger.warn({ err: e, documentId: d.id }, "Cleanup failed");
            }
        }
    } catch (err) {
        logger.error({ err }, "Knowledge ingestion poll error");
    }
    timer = setTimeout(poll, 5000);
}

export function startKnowledgeIngestionWorker() {
    if (running) return;
    running = true;
    logger.info("Knowledge ingestion worker started");
    poll();
}

export function stopKnowledgeIngestionWorker() {
    running = false;
    if (timer) clearTimeout(timer);
}
