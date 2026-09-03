import type { PrismaClient } from "../../generated/prisma/client.js";
import { Prisma } from "../../generated/prisma/client.js";

export class MessageRepository {
    constructor(private readonly db: PrismaClient) {}

    async getNextSequence(conversationId: string): Promise<number> {
        const last = await this.db.message.findFirst({
            where: { conversationId },
            orderBy: { sequence: "desc" },
            select: { sequence: true },
        });
        return (last?.sequence ?? 0) + 1;
    }

    async findByIdempotencyKey(conversationId: string, key: string) {
        return this.db.message.findUnique({ where: { conversationId_idempotencyKey: { conversationId, idempotencyKey: key } } });
    }

    async createWithSequence(params: {
        conversationId: string;
        role: "USER" | "CHARACTER" | "ASSISTANT" | "SYSTEM" | "TOOL";
        messageType?: "OPENING_SCENE" | "TEXT" | "TOOL_CALL" | "SYSTEM_EVENT";
        content: string;
        idempotencyKey?: string | null;
        sequence?: number;
        characterVersionId?: string | null;
        attachments?: unknown;
        metadata?: unknown;
        modelProvider?: string | null;
        modelName?: string | null;
        inputTokens?: number | null;
        outputTokens?: number | null;
        generationId?: string | null;
    }) {
        const sequence = params.sequence ?? (await this.getNextSequence(params.conversationId));
        const role = params.role === "CHARACTER" ? "ASSISTANT" : params.role;
        return this.db.message.create({
            data: {
                conversationId: params.conversationId,
                role: role as never,
                messageType: (params.messageType ?? "TEXT") as never,
                content: params.content,
                sequence,
                characterVersionId: params.characterVersionId ?? null,
                idempotencyKey: params.idempotencyKey ?? null,
                attachments: (params.attachments as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                metadata: (params.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                modelProvider: params.modelProvider ?? null,
                modelName: params.modelName ?? null,
                inputTokens: params.inputTokens ?? null,
                outputTokens: params.outputTokens ?? null,
                generationId: params.generationId ?? null,
            },
        });
    }

    /** Cursor-based pagination per spec §19 — never load 10k messages */
    async listCursor(
        conversationId: string,
        params: { cursor?: string | null; limit?: number; direction?: "forward" | "backward" },
    ) {
        const limit = Math.min(params.limit ?? 30, 100);
        const cursor = params.cursor;
        const where: Prisma.MessageWhereInput = { conversationId };
        const orderBy = { sequence: "asc" as const };

        if (cursor) {
            const decoded = Buffer.from(cursor, "base64").toString("utf-8");
            const seq = parseInt(decoded, 10);
            if (!Number.isNaN(seq)) {
                where.sequence = params.direction === "backward" ? { lt: seq } : { gt: seq };
            }
        }

        const rows = await this.db.message.findMany({
            where,
            orderBy,
            take: limit + 1,
        });

        const hasMore = rows.length > limit;
        const data = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? Buffer.from(String(data[data.length - 1].sequence)).toString("base64") : null;

        return { data, nextCursor, hasMore };
    }

    async list(conversationId: string, params: { page: number; limit: number; before?: Date; after?: Date }) {
        const where: Prisma.MessageWhereInput = { conversationId };
        if (params.before) where.createdAt = { lt: params.before };
        if (params.after) where.createdAt = { gt: params.after };

        const [total, data] = await Promise.all([
            this.db.message.count({ where }),
            this.db.message.findMany({
                where,
                orderBy: { sequence: "asc" },
                skip: (params.page - 1) * params.limit,
                take: params.limit,
            }),
        ]);
        return { data, meta: { page: params.page, limit: params.limit, total, totalPages: Math.ceil(total / params.limit) } };
    }

    async recent(conversationId: string, limit = 30) {
        return this.db.message.findMany({
            where: { conversationId },
            orderBy: { sequence: "desc" },
            take: limit,
        }).then((rows) => rows.reverse());
    }

    async findById(id: string, conversationId: string) {
        return this.db.message.findFirst({ where: { id, conversationId } });
    }
}
