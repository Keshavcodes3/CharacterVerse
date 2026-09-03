import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { apiSuccess } from "../../utils/apiSuccess.js";
import { knowledgeService } from "./knowledge.service.js";

export class KnowledgeController {
    createKB = asyncHandler(async (req: Request, res: Response) => {
        const { characterId } = req.params as { characterId: string };
        const userId = req.user!.id;
        const kb = await knowledgeService.createKnowledgeBase(characterId, userId, req.body);
        return apiSuccess(res, { statusCode: 201, message: "Knowledge base created", data: { knowledgeBase: kb } });
    });

    listKB = asyncHandler(async (req: Request, res: Response) => {
        const { characterId } = req.params as { characterId: string };
        const userId = req.user!.id;
        const list = await knowledgeService.listKnowledgeBases(characterId, userId);
        return apiSuccess(res, { message: "Knowledge bases fetched", data: list });
    });

    createDocument = asyncHandler(async (req: Request, res: Response) => {
        const { characterId } = req.params as { characterId: string };
        const userId = req.user!.id;
        const b = req.body as { knowledgeBaseId?: string | null; title: string; content?: string | null; rawContent?: string | null; sourceUrl?: string | null; mimeType?: string; metadata?: Record<string, unknown> | null; chunkSize?: number; chunkOverlap?: number; chunkStrategy?: "recursive" | "fixed" | "paragraph" };
        const doc = await knowledgeService.createDocument(
            {
                characterId,
                knowledgeBaseId: b.knowledgeBaseId ?? null,
                title: b.title,
                content: b.content ?? null,
                rawContent: b.rawContent ?? null,
                sourceUrl: b.sourceUrl ?? null,
                mimeType: (b.mimeType as string) ?? "text/plain",
                chunkOptions: { chunkSize: b.chunkSize ?? 800, overlap: b.chunkOverlap ?? 150, strategy: b.chunkStrategy ?? "recursive" },
                metadata: b.metadata ?? null,
            },
            userId,
        );
        return apiSuccess(res, { statusCode: 202, message: "Document accepted — processing async", data: { document: doc } });
    });

    listDocuments = asyncHandler(async (req: Request, res: Response) => {
        const { characterId } = req.params as { characterId: string };
        const userId = req.user!.id;
        const q = req.query as unknown as { knowledgeBaseId?: string; status?: string; page?: number; limit?: number };
        const result = await knowledgeService.listDocuments(characterId, q.knowledgeBaseId ?? null, userId, { page: q.page, limit: q.limit, status: q.status });
        return apiSuccess(res, { message: "Documents fetched", data: result.data, meta: result.meta });
    });

    getDocument = asyncHandler(async (req: Request, res: Response) => {
        const { characterId, documentId } = req.params as { characterId: string; documentId: string };
        const userId = req.user!.id;
        if (characterId) void characterId; // ownership checked inside service via document's characterId
        const doc = await knowledgeService.getDocument(documentId, userId);
        return apiSuccess(res, { message: "Document fetched", data: { document: doc } });
    });

    deleteDocument = asyncHandler(async (req: Request, res: Response) => {
        const { documentId } = req.params as { documentId: string };
        const userId = req.user!.id;
        const result = await knowledgeService.deleteDocument(documentId, userId);
        return apiSuccess(res, { message: "Document deletion enqueued", data: result });
    });

    search = asyncHandler(async (req: Request, res: Response) => {
        const { characterId } = req.params as { characterId: string };
        const userId = req.user!.id;
        // authz: ensure owner or public reader can search only owned character's KB (isolation)
        // For now require ownership for search as well (private KB)
        const q = req.query as unknown as { q: string; knowledgeBaseId?: string; topK?: number; topN?: number };
        // verify owner
        const { prisma } = await import("../../infrastructure/database/db.js");
        const char = await prisma.character.findUnique({ where: { id: characterId }, select: { creatorId: true } });
        if (!char) return apiSuccess(res, { statusCode: 404, message: "Character not found" } as never);
        if (char.creatorId !== userId) return apiSuccess(res, { statusCode: 403, message: "Forbidden" } as never);
        const results = await knowledgeService.retrieveRelevantKnowledge({ characterId, knowledgeBaseId: q.knowledgeBaseId ?? null, query: q.q, topK: q.topK, topN: q.topN });
        return apiSuccess(res, { message: "Knowledge search completed", data: results });
    });
}
