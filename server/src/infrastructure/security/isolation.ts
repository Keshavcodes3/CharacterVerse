import { prisma } from "../database/db.js";
import { ApiError } from "../../utils/apiError.js";

/**
 * Privacy / Isolation guarantees per spec §9
 * Every service boundary must enforce that User A cannot access User B's resources
 */

export async function assertConversationOwner(conversationId: string, userId: string) {
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { userId: true } });
    if (!conv) throw new ApiError(404, "Conversation not found", "NOT_FOUND");
    if (conv.userId !== userId) throw new ApiError(403, "Not your conversation", "FORBIDDEN");
    return conv;
}

export async function assertMessageOwner(conversationId: string, messageId: string, userId: string) {
    await assertConversationOwner(conversationId, userId);
    const msg = await prisma.message.findUnique({ where: { id: messageId }, select: { conversationId: true } });
    if (!msg || msg.conversationId !== conversationId) throw new ApiError(404, "Message not found", "NOT_FOUND");
}

export async function assertMemoryAccess(memoryId: string, userId: string, characterId: string) {
    const mem = await prisma.memory.findUnique({ where: { id: memoryId }, select: { userId: true, characterId: true } });
    if (!mem) throw new ApiError(404, "Memory not found", "NOT_FOUND");
    if (mem.userId !== userId) throw new ApiError(403, "Not your memory", "FORBIDDEN");
    if (mem.characterId !== characterId) throw new ApiError(403, "Memory character mismatch", "FORBIDDEN");
}

export async function assertKnowledgeBaseOwner(knowledgeBaseId: string, userId: string) {
    const kb = await prisma.knowledgeBase.findUnique({ where: { id: knowledgeBaseId }, include: { character: { select: { creatorId: true } } } });
    if (!kb) throw new ApiError(404, "Knowledge base not found", "NOT_FOUND");
    if (kb.character.creatorId !== userId) throw new ApiError(403, "Not your knowledge base", "FORBIDDEN");
}

export async function assertPrivateCharacterAccess(characterId: string, requesterId?: string | null, requesterRole?: string | null) {
    const char = await prisma.character.findUnique({ where: { id: characterId }, select: { visibility: true, status: true, creatorId: true } });
    if (!char) throw new ApiError(404, "Character not found", "NOT_FOUND");
    const isOwner = char.creatorId === requesterId;
    const isAdmin = requesterRole === "ADMIN" || requesterRole === "OWNER" || requesterRole === "MODERATOR";
    if (char.visibility === "PRIVATE" && !isOwner && !isAdmin) throw new ApiError(403, "Private character", "FORBIDDEN");
    if (char.status === "SUSPENDED" && !isOwner && !isAdmin) throw new ApiError(403, "Character suspended", "FORBIDDEN");
}

export async function assertDocumentOwner(documentId: string, userId: string) {
    const doc = await prisma.knowledgeDocument.findUnique({
        where: { id: documentId },
        include: { knowledgeBase: { select: { characterId: true } } },
        // fallback via characterId direct? KnowledgeDocument has no direct character relation in prisma? Actually it has no relation to Character, only characterId string.
        // So we need to fetch character separately
    });
    if (!doc) throw new ApiError(404, "Document not found", "NOT_FOUND");
    const char = await prisma.character.findUnique({ where: { id: doc.characterId }, select: { creatorId: true } });
    if (!char || char.creatorId !== userId) throw new ApiError(403, "Not your document", "FORBIDDEN");
}
