import { ApiError } from "../../utils/apiError.js";
import type { ConversationRepository } from "./conversation.repository.js";
import type { CharacterRepository } from "../characters/character.repository.js";
import { prisma } from "../../infrastructure/database/db.js";
import { logger } from "../../config/pino.js";
async function cacheDelDiscovery() {
    try {
        const { cache } = await import("../../infrastructure/cache/cache.js");
        await cache.delByPrefix("discovery:");
    } catch {}
}

export class ConversationService {
    constructor(
        private readonly convRepo: ConversationRepository,
        private readonly charRepo: CharacterRepository,
    ) {}

    async create(userId: string, characterIdOrSlug: string, title?: string) {
        const character = await this.charRepo.findByIdOrSlug(characterIdOrSlug);
        if (!character) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        // character state validation per spec §27
        if (character.status === "SUSPENDED") throw new ApiError(403, "Character suspended", "CHARACTER_SUSPENDED");
        if (character.status === "ARCHIVED") throw new ApiError(403, "Character archived", "CHARACTER_ARCHIVED");
        if (character.status !== "PUBLISHED") throw new ApiError(400, `Character is ${character.status}, cannot start conversation`, "CHARACTER_NOT_AVAILABLE");
        if (character.visibility === "PRIVATE" && character.creatorId !== userId) throw new ApiError(403, "Cannot converse with private character", "FORBIDDEN");

        const versionId = (character as unknown as { currentVersionId?: string | null }).currentVersionId ?? null;
        const version = versionId ? await prisma.characterVersion.findUnique({ where: { id: versionId } }) : null;
        const greeting = version?.greeting ?? character.greeting;

        // Atomic: conversation + opening scene message + outbox — spec §2
        const result = await prisma.$transaction(async (tx) => {
            const conv = await tx.conversation.create({
                data: {
                    userId,
                    characterId: character.id,
                    characterVersionId: versionId,
                    title: title ?? null,
                    status: "ACTIVE",
                },
            });

            // OPENING_SCENE persisted as first message, distinguish from ASSISTANT_TEXT
            const opening = await tx.message.create({
                data: {
                    conversationId: conv.id,
                    role: "ASSISTANT" as never,
                    messageType: "OPENING_SCENE" as never,
                    content: greeting,
                    sequence: 1,
                    characterVersionId: versionId,
                },
            });

            await tx.outboxEvent.create({
                data: {
                    aggregateType: "Conversation",
                    aggregateId: conv.id,
                    eventType: "ConversationCreated",
                    payload: { conversationId: conv.id, characterId: character.id, characterVersionId: versionId, userId, openingMessageId: opening.id } as never,
                    status: "PENDING",
                },
            });

            // return with includes for API
            const full = await tx.conversation.findUnique({
                where: { id: conv.id },
                include: {
                    character: { include: { personality: true, profile: true, currentVersion: true } },
                    characterVersion: true,
                    messages: { orderBy: { sequence: "asc" }, take: 1 },
                },
            });
            return { conversation: full!, openingMessage: opening };
        });

        logger.info({ conversationId: result.conversation.id, characterId: character.id, userId, characterVersionId: versionId }, "Conversation created with opening scene");

        // increment chatCount denormalized for discovery (non-blocking, idempotent per conversation)
        void prisma.character.update({ where: { id: character.id }, data: { chatCount: { increment: 1 } } }).catch(() => {});
        void cacheDelDiscovery();

        // async title generation trigger (non-blocking) if no title provided
        if (!title) {
            void this.generateTitleAsync(result.conversation.id, character.id).catch(() => {});
        }

        return { conversation: result.conversation, openingMessage: result.openingMessage };
    }

    private async generateTitleAsync(conversationId: string, _characterId: string) {
        try {
            const { titlePrompt } = await import("../ai/Prompts/title.prompt.js");
            const { getModel } = await import("../ai/providers/index.js");
            const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { messages: { take: 3, orderBy: { sequence: "asc" } } } });
            if (!conv || conv.title) return;
            const snippet = conv.messages.map((m) => m.content.slice(0, 200)).join("\n").slice(0, 800);
            if (snippet.length < 10) return;
            const model = getModel("mistral");
            const msgs = await titlePrompt.formatMessages({ charName: conv.characterId, snippet });
            const res = await model.invoke(msgs);
            const title = (typeof res.content === "string" ? res.content : String(res.content)).trim().slice(0, 80).replace(/^["']|["']$/g, "");
            if (title.length >= 3) await prisma.conversation.update({ where: { id: conversationId }, data: { title } });
        } catch (err) {
            logger.warn({ err, conversationId }, "Title generation failed");
        }
    }

    async getForUser(conversationId: string, userId: string) {
        const conv = await this.convRepo.findByIdForUser(conversationId, userId);
        if (!conv) throw new ApiError(404, "Conversation not found", "CONVERSATION_NOT_FOUND");
        return conv;
    }

    async listForUser(userId: string, filters: { page: number; limit: number; characterId?: string; status?: string }) {
        return this.convRepo.listForUser(userId, filters);
    }

    async update(conversationId: string, userId: string, data: { title?: string | null; summary?: string | null; status?: "ACTIVE" | "ARCHIVED" | "DELETED" }) {
        const conv = await this.convRepo.findByIdForUser(conversationId, userId);
        if (!conv) throw new ApiError(404, "Conversation not found", "CONVERSATION_NOT_FOUND");
        if (data.status === "DELETED" && conv.status === "DELETED") throw new ApiError(400, "Already deleted", "INVALID_STATUS");
        const updated = await this.convRepo.update(conversationId, { title: data.title as never, summary: data.summary as never, status: data.status as never });

        const eventType = data.status === "ARCHIVED" ? "ConversationArchived" : data.status === "DELETED" ? "ConversationDeleted" : "ConversationUpdated";
        await prisma.outboxEvent.create({
            data: { aggregateType: "Conversation", aggregateId: conversationId, eventType, payload: { conversationId, userId, ...data } as never, status: "PENDING" },
        });

        return updated;
    }
}
