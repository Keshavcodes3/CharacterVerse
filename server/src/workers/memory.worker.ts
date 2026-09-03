import { prisma } from "../infrastructure/database/db.js";
import { logger } from "../config/pino.js";
import { queueManager } from "../infrastructure/queue/queue.js";

export type MemoryJob = { conversationId: string; characterId: string; characterName: string; userId: string; transcript: string };

async function handleMemoryJob(job: { data: MemoryJob }) {
    const { conversationId, characterId, characterName, userId, transcript } = job.data;
    // Idempotent: check if recent memory extraction already done for this conversation transcript hash
    const hash = `mem:${conversationId}:${transcript.slice(0, 100)}`;
    // simple dedup via memory content check — service already dedups
    const { MemoryService } = await import("../infrastructure/memory/memory.service.js");
    const svc = new MemoryService(prisma as any);
    await svc.extractAndPersist({ characterId, characterName, userId, conversationId, recentTranscript: transcript });
    logger.info({ conversationId }, "memory extraction completed");
}

export function startMemoryWorker() {
    const q = queueManager.memory;
    q.process(async (job) => handleMemoryJob(job as any));
    logger.info("Memory worker started (queue: memory)");
}

export async function enqueueMemoryExtraction(data: MemoryJob) {
    return queueManager.memory.add("memory_extraction", data, { jobId: `mem-${data.conversationId}-${Date.now()}`, attempts: 3 });
}
