import { prisma } from "../../infrastructure/database/db.js";
import type { Prisma } from "../../generated/prisma/client.js";

export class DocumentRepository {
    async create(data: Prisma.KnowledgeDocumentCreateInput) {
        return prisma.knowledgeDocument.create({ data });
    }

    async findById(id: string) {
        return prisma.knowledgeDocument.findUnique({ where: { id }, include: { chunks: false } });
    }

    async findByIdWithChunks(id: string) {
        return prisma.knowledgeDocument.findUnique({ where: { id }, include: { chunks: true } });
    }

    async listByKnowledgeBase(knowledgeBaseId: string, opts?: { status?: string; page?: number; limit?: number }) {
        const where: Prisma.KnowledgeDocumentWhereInput = { knowledgeBaseId };
        if (opts?.status) where.status = opts.status as never;
        else where.status = { not: "DELETED" } as never;
        const page = opts?.page ?? 1; const limit = opts?.limit ?? 20;
        const [total, data] = await Promise.all([
            prisma.knowledgeDocument.count({ where }),
            prisma.knowledgeDocument.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
        ]);
        return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    }

    async listByCharacter(characterId: string, opts?: { status?: string }) {
        const where: Prisma.KnowledgeDocumentWhereInput = { characterId };
        if (opts?.status) where.status = opts.status as never;
        return prisma.knowledgeDocument.findMany({ where, orderBy: { createdAt: "desc" } });
    }

    async updateStatus(id: string, status: "PENDING" | "PROCESSING" | "READY" | "FAILED" | "DELETED", extra?: { error?: string | null; chunkCount?: number | null }) {
        return prisma.knowledgeDocument.update({ where: { id }, data: { status: status as never, error: extra?.error ?? undefined, chunkCount: extra?.chunkCount ?? undefined } });
    }

    async softDelete(id: string) {
        return prisma.knowledgeDocument.update({ where: { id }, data: { status: "DELETED" as never } });
    }

    async hardDelete(id: string) {
        return prisma.knowledgeDocument.delete({ where: { id } });
    }

    async findDueIngestionJobs(limit = 10) {
        return prisma.ingestionJob.findMany({ where: { status: { in: ["PENDING", "FAILED"] } as never, nextAttemptAt: { lte: new Date() } as never }, take: limit, orderBy: { createdAt: "asc" } });
    }

    async findPendingJobs(limit = 20) {
        return prisma.ingestionJob.findMany({ where: { status: "PENDING" as never }, take: limit, orderBy: { createdAt: "asc" } });
    }
}

export const documentRepo = new DocumentRepository();
