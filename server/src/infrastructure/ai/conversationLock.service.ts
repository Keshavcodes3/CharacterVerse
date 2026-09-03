import { prisma } from "../database/db.js";
import { logger } from "../../config/pino.js";

/**
 * Conversation concurrency control per spec §13
 * In-process DB lock via generationLockId unique field; compatible with Redis distributed lock future.
 * Invariant: deterministic message ordering via sequence.
 */
export class ConversationLockService {
    async acquire(conversationId: string, generationId: string): Promise<boolean> {
        const result = await prisma.conversation.updateMany({
            where: { id: conversationId, generationLockId: null, status: "ACTIVE" },
            data: { generationLockId: generationId, lockedAt: new Date() },
        });
        const ok = result.count === 1;
        if (!ok) logger.warn({ conversationId, generationId }, "Conversation lock contention");
        return ok;
    }

    async release(conversationId: string, generationId: string) {
        await prisma.conversation.updateMany({
            where: { id: conversationId, generationLockId: generationId },
            data: { generationLockId: null, lockedAt: null },
        });
    }

    /** Force release stale locks > 5min (e.g. crashed generation) */
    async releaseStale(timeoutMs = 5 * 60 * 1000) {
        const cutoff = new Date(Date.now() - timeoutMs);
        await prisma.conversation.updateMany({
            where: { lockedAt: { lt: cutoff } as never, generationLockId: { not: null } as never },
            data: { generationLockId: null, lockedAt: null },
        });
    }
}

export const conversationLock = new ConversationLockService();
