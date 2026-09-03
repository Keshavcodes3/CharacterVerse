import type { PrismaClient, Prisma, OutboxStatus } from "../../generated/prisma/client.js";

export type OutboxEventInput = {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Prisma.InputJsonValue;
};

export class OutboxRepository {
    constructor(private readonly db: PrismaClient) {}

    async create(tx: Prisma.TransactionClient, input: OutboxEventInput) {
        return tx.outboxEvent.create({
            data: {
                aggregateType: input.aggregateType,
                aggregateId: input.aggregateId,
                eventType: input.eventType,
                payload: input.payload,
                status: "PENDING",
            },
        });
    }

    async createMany(tx: Prisma.TransactionClient, inputs: OutboxEventInput[]) {
        if (inputs.length === 0) return [];
        return tx.outboxEvent.createMany({
            data: inputs.map((i) => ({
                aggregateType: i.aggregateType,
                aggregateId: i.aggregateId,
                eventType: i.eventType,
                payload: i.payload as never,
                status: "PENDING" as OutboxStatus,
            })),
        });
    }

    async claimPending(limit = 10) {
        // simple polling claim: mark as PROCESSING
        const events = await this.db.outboxEvent.findMany({
            where: { status: "PENDING", nextAttemptAt: { lte: new Date() } as never },
            take: limit,
            orderBy: { createdAt: "asc" },
        });
        // fallback if nextAttemptAt null
        if (events.length === 0) {
            return this.db.outboxEvent.findMany({
                where: { status: "PENDING" },
                take: limit,
                orderBy: { createdAt: "asc" },
            });
        }
        return events;
    }

    async markProcessed(id: string) {
        return this.db.outboxEvent.update({
            where: { id },
            data: { status: "PROCESSED", processedAt: new Date() },
        });
    }

    async markFailed(id: string, error: string, nextAttemptAt?: Date) {
        return this.db.outboxEvent.update({
            where: { id },
            data: {
                status: "FAILED",
                lastError: error,
                attempts: { increment: 1 },
                nextAttemptAt: nextAttemptAt ?? new Date(Date.now() + 60_000),
            },
        });
    }
}

export const OutboxEventTypes = {
    CharacterCreated: "CharacterCreated",
    CharacterUpdated: "CharacterUpdated",
    CharacterPublished: "CharacterPublished",
    CharacterArchived: "CharacterArchived",
    CharacterSuspended: "CharacterSuspended",
    CharacterDeleted: "CharacterDeleted",
    ConversationCreated: "ConversationCreated",
    UserMessageCreated: "UserMessageCreated",
    AssistantMessageCreated: "AssistantMessageCreated",
    GenerationStarted: "GenerationStarted",
    GenerationCompleted: "GenerationCompleted",
    GenerationFailed: "GenerationFailed",
    MemoryCreated: "MemoryCreated",
} as const;
