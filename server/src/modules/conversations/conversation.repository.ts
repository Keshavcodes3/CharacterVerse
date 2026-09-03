import type { PrismaClient, Prisma } from "../../generated/prisma/client.js";

const conversationInclude = {
    character: { include: { personality: true, profile: true, currentVersion: true } },
    characterVersion: true,
    _count: { select: { messages: true } },
} as const;

export class ConversationRepository {
    constructor(private readonly db: PrismaClient) {}

    async create(params: { userId: string; characterId: string; characterVersionId?: string | null; title?: string | null }) {
        return this.db.conversation.create({
            data: {
                userId: params.userId,
                characterId: params.characterId,
                characterVersionId: params.characterVersionId ?? null,
                title: params.title ?? null,
                status: "ACTIVE",
            },
            include: conversationInclude,
        });
    }

    async findById(id: string) {
        return this.db.conversation.findUnique({ where: { id }, include: conversationInclude });
    }

    async findByIdForUser(id: string, userId: string) {
        return this.db.conversation.findFirst({ where: { id, userId }, include: conversationInclude });
    }

    async listForUser(userId: string, filters: { page: number; limit: number; characterId?: string; status?: string }) {
        const where: Prisma.ConversationWhereInput = { userId };
        if (filters.characterId) where.characterId = filters.characterId;
        if (filters.status) where.status = filters.status as never;
        else where.status = { not: "DELETED" } as never;

        const [total, data] = await Promise.all([
            this.db.conversation.count({ where }),
            this.db.conversation.findMany({
                where,
                include: { character: { select: { id: true, name: true, slug: true, avatarUrl: true } }, _count: { select: { messages: true } } },
                orderBy: { lastMessageAt: "desc" },
                skip: (filters.page - 1) * filters.limit,
                take: filters.limit,
            }),
        ]);
        return { data, meta: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) } };
    }

    async update(id: string, data: Prisma.ConversationUpdateInput) {
        return this.db.conversation.update({ where: { id }, data, include: conversationInclude });
    }

    async tryAcquireLock(conversationId: string, generationId: string): Promise<boolean> {
        // Optimistic lock via generationLockId unique field — if already locked, update will fail due to unique constraint or check
        const result = await this.db.conversation.updateMany({
            where: { id: conversationId, generationLockId: null, status: "ACTIVE" },
            data: { generationLockId: generationId, lockedAt: new Date() },
        });
        return result.count === 1;
    }

    async releaseLock(conversationId: string, generationId: string) {
        await this.db.conversation.updateMany({
            where: { id: conversationId, generationLockId: generationId },
            data: { generationLockId: null, lockedAt: null },
        });
    }

    async touchLastMessage(conversationId: string) {
        return this.db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), updatedAt: new Date(), version: { increment: 1 } } });
    }
}
