import { prisma } from "../../infrastructure/database/db.js";
import { ApiError } from "../../utils/apiError.js";

function slugify(s: string) {
    return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export class KnowledgeBaseRepository {
    async ensureOwnership(characterId: string, requesterId: string) {
        const c = await prisma.character.findUnique({ where: { id: characterId }, select: { id: true, creatorId: true } });
        if (!c) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        if (c.creatorId !== requesterId) throw new ApiError(403, "Only owner can manage knowledge base", "FORBIDDEN");
        return c;
    }

    async getOrCreateDefault(characterId: string) {
        const existing = await prisma.knowledgeBase.findFirst({ where: { characterId } });
        if (existing) return existing;
        const char = await prisma.character.findUnique({ where: { id: characterId }, select: { name: true } });
        const name = "default";
        const slug = "default";
        return prisma.knowledgeBase.create({ data: { characterId, name, slug, description: `Knowledge base for ${char?.name ?? characterId}` } });
    }

    async create(characterId: string, data: { name: string; description?: string | null }) {
        const slug = slugify(data.name);
        const exists = await prisma.knowledgeBase.findUnique({ where: { characterId_slug: { characterId, slug } } });
        if (exists) throw new ApiError(409, "Knowledge base with this name already exists", "KB_EXISTS");
        return prisma.knowledgeBase.create({ data: { characterId, name: data.name, slug, description: data.description ?? null } });
    }

    async list(characterId: string) {
        return prisma.knowledgeBase.findMany({ where: { characterId }, orderBy: { createdAt: "asc" }, include: { _count: { select: { documents: true } } } });
    }

    async findById(kbId: string) {
        return prisma.knowledgeBase.findUnique({ where: { id: kbId } });
    }

    async findByCharacterAndSlug(characterId: string, slug: string) {
        return prisma.knowledgeBase.findUnique({ where: { characterId_slug: { characterId, slug } } });
    }

    async delete(kbId: string) {
        return prisma.knowledgeBase.delete({ where: { id: kbId } });
    }
}

export const knowledgeBaseRepo = new KnowledgeBaseRepository();
