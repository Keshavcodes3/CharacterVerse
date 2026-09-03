import { prisma } from "../database/db.js";
import { logger } from "../../config/pino.js";

/**
 * Generation lifecycle per spec §11 — QUEUED → RUNNING → COMPLETED/FAILED/CANCELLED
 * Separate from Message to allow observability without polluting message state.
 */
export class GenerationService {
    async create(params: { conversationId: string; userMessageId?: string | null; provider?: string | null; model?: string | null; requestId?: string | null }) {
        const gen = await prisma.generation.create({
            data: {
                conversationId: params.conversationId,
                userMessageId: params.userMessageId ?? null,
                provider: params.provider ?? null,
                model: params.model ?? null,
                status: "QUEUED" as never,
                requestId: params.requestId ?? null,
            },
        });
        await prisma.outboxEvent.create({
            data: { aggregateType: "Generation", aggregateId: gen.id, eventType: "GenerationStarted", payload: { generationId: gen.id, conversationId: params.conversationId } as never, status: "PENDING" },
        });
        return gen;
    }

    async markRunning(id: string) {
        return prisma.generation.update({ where: { id }, data: { status: "RUNNING" as never, startedAt: new Date() } });
    }

    async markCompleted(id: string, data: { inputTokens?: number; outputTokens?: number; latencyMs?: number; messageId?: string }) {
        const gen = await prisma.generation.update({
            where: { id },
            data: {
                status: "COMPLETED" as never,
                completedAt: new Date(),
                inputTokens: data.inputTokens ?? null,
                outputTokens: data.outputTokens ?? null,
                latencyMs: data.latencyMs ?? null,
                messageId: data.messageId ?? null,
            },
        });
        await prisma.outboxEvent.create({
            data: { aggregateType: "Generation", aggregateId: id, eventType: "GenerationCompleted", payload: { generationId: id, ...data } as never, status: "PENDING" },
        });
        logger.info({ generationId: id, latencyMs: data.latencyMs, inputTokens: data.inputTokens, outputTokens: data.outputTokens }, "Generation completed");
        return gen;
    }

    async markFailed(id: string, error: string, errorCode?: string) {
        const gen = await prisma.generation.update({
            where: { id },
            data: { status: "FAILED" as never, completedAt: new Date(), error: error.slice(0, 2000), errorCode: errorCode ?? "UNKNOWN" },
        });
        await prisma.outboxEvent.create({
            data: { aggregateType: "Generation", aggregateId: id, eventType: "GenerationFailed", payload: { generationId: id, error } as never, status: "PENDING" },
        });
        logger.warn({ generationId: id, error, errorCode }, "Generation failed");
        return gen;
    }

    async markCancelled(id: string) {
        return prisma.generation.update({ where: { id }, data: { status: "CANCELLED" as never, completedAt: new Date() } });
    }
}

export const generationService = new GenerationService();
