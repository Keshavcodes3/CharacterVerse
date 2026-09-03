import crypto from "node:crypto";
import { ApiError } from "../../utils/apiError.js";
import type { ConversationRepository } from "../conversations/conversation.repository.js";
import type { MessageRepository } from "./message.repository.js";
import { prisma } from "../../infrastructure/database/db.js";
import { messageModerationService } from "../../infrastructure/moderation/messageModeration.service.js";
import { inputSanitizer } from "../../infrastructure/safety/inputSanitizer.js";
import { assertConversationOwner } from "../../infrastructure/security/isolation.js";

export class MessageService {
    constructor(
        private readonly convRepo: ConversationRepository,
        private readonly msgRepo: MessageRepository,
    ) {}

    async list(conversationId: string, userId: string, q: { page: number; limit: number; before?: string; after?: string }) {
        const conv = await this.convRepo.findByIdForUser(conversationId, userId);
        if (!conv) throw new ApiError(404, "Conversation not found", "CONVERSATION_NOT_FOUND");
        return this.msgRepo.list(conversationId, {
            page: q.page, limit: q.limit,
            before: q.before ? new Date(q.before) : undefined,
            after: q.after ? new Date(q.after) : undefined,
        });
    }

    async createUserMessage(params: { conversationId: string; userId: string; content: string; idempotencyKey?: string; attachments?: unknown; metadata?: unknown }) {
        // Privacy isolation
        await assertConversationOwner(params.conversationId, params.userId);
        const conv = await this.convRepo.findByIdForUser(params.conversationId, params.userId);
        if (!conv) throw new ApiError(404, "Conversation not found", "CONVERSATION_NOT_FOUND");
        if (conv.status !== "ACTIVE") throw new ApiError(400, `Conversation is ${conv.status}`, "CONVERSATION_NOT_ACTIVE");
        // character availability
        const character = conv.character;
        if (!character || (character as unknown as { status?: string }).status !== "PUBLISHED") {
            // allow if already active conversation but warn
            if ((character as unknown as { status?: string }).status === "SUSPENDED" || (character as unknown as { status?: string }).status === "ARCHIVED") {
                throw new ApiError(400, `Character is ${(character as unknown as { status?: string }).status}`, "CHARACTER_NOT_AVAILABLE");
            }
        }

        // AI Input Safety + Message Moderation pipeline (spec §3,§4)
        const sanitized = inputSanitizer.sanitize(params.content, { characterId: conv.characterId, userId: params.userId });
        if (sanitized.shouldBlock) {
            throw new ApiError(400, "Message blocked by safety filter", "BLOCKED_BY_MODERATION");
        }
        const moderation = await messageModerationService.check(sanitized.sanitizedContent, { userId: params.userId, conversationId: params.conversationId });
        if (moderation.verdict === "BLOCK") {
            // Audit
            const { auditService } = await import("../../infrastructure/audit/audit.service.js");
            await auditService.log({ actorId: params.userId, action: "MESSAGE_BLOCKED", targetType: "MESSAGE", targetId: params.conversationId, reason: moderation.reason, metadata: { content: params.content.slice(0, 200) } });
            throw new ApiError(400, `Message blocked: ${moderation.reason}`, "BLOCKED_BY_MODERATION");
        }
        if (moderation.verdict === "REVIEW") {
            // Async review: create moderation case but allow message (spec says do not necessarily block synchronously)
            const { moderationService } = await import("../../infrastructure/moderation/moderation.service.js");
            void moderationService.createCase({ targetType: "MESSAGE", targetId: params.conversationId, reason: (moderation.reason as any) ?? "OTHER", description: params.content.slice(0, 500), reporterId: params.userId, metadata: { content: params.content, moderation } }).catch(() => {});
            // Continue — but log
        }

        const effectiveContent = inputSanitizer.buildSafeUserMessage(sanitized.sanitizedContent);

        const key = params.idempotencyKey ?? crypto.randomUUID();

        // Idempotency check: if exists return it (no duplicate gen trigger — caller should handle)
        const existing = await this.msgRepo.findByIdempotencyKey(params.conversationId, key);
        if (existing) return { message: existing, isDuplicate: true as const };

        // Atomic create with sequence: use transaction + retry on unique violation
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const msg = await prisma.$transaction(async (tx) => {
                    // compute next seq inside tx
                    const last = await tx.message.findFirst({ where: { conversationId: params.conversationId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
                    const seq = (last?.sequence ?? 0) + 1;
                    const created = await tx.message.create({
                        data: {
                            conversationId: params.conversationId,
                            role: "USER" as never,
                            content: effectiveContent,
                            sequence: seq,
                            idempotencyKey: key,
                            attachments: (params.attachments as never) ?? undefined,
                            metadata: (params.metadata as never) ?? undefined,
                        },
                    });
                    await tx.conversation.update({ where: { id: params.conversationId }, data: { lastMessageAt: new Date(), updatedAt: new Date() } });
                    await tx.outboxEvent.create({ data: { aggregateType: "Conversation", aggregateId: params.conversationId, eventType: "UserMessageCreated", payload: { conversationId: params.conversationId, messageId: created.id, userId: params.userId } as never, status: "PENDING" } });
                    return created;
                });
                return { message: msg, isDuplicate: false as const, idempotencyKey: key };
            } catch (e: unknown) {
                const msg = (e as Error).message ?? "";
                if (msg.includes("Unique constraint") || msg.includes("unique")) {
                    const dup = await this.msgRepo.findByIdempotencyKey(params.conversationId, key);
                    if (dup) return { message: dup, isDuplicate: true as const };
                    continue;
                }
                throw e;
            }
        }
        throw new ApiError(409, "Failed to create message after retries", "CONFLICT");
    }
}
