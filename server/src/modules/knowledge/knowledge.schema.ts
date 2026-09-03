import { z } from "zod";

export const createKnowledgeBaseSchema = z.object({
    params: z.object({ characterId: z.string().uuid() }),
    body: z.object({ name: z.string().min(1).max(100).trim(), description: z.string().max(2000).optional().nullable() }),
});

export const createDocumentSchema = z.object({
    params: z.object({ characterId: z.string().uuid() }),
    body: z.object({
        knowledgeBaseId: z.string().uuid().optional().nullable(),
        title: z.string().min(1).max(300).trim(),
        content: z.string().max(500_000).optional().nullable(), // text/markdown
        rawContent: z.string().max(500_000).optional().nullable(),
        sourceUrl: z.string().url().optional().nullable(),
        mimeType: z.enum(["text/plain", "text/markdown", "application/pdf", "text/html"]).optional().default("text/plain"),
        metadata: z.record(z.string(), z.unknown()).optional().nullable(),
        chunkSize: z.coerce.number().int().min(100).max(4000).optional().default(800),
        chunkOverlap: z.coerce.number().int().min(0).max(500).optional().default(150),
        chunkStrategy: z.enum(["recursive", "fixed", "paragraph"]).optional().default("recursive"),
    }),
});

export const listDocumentsSchema = z.object({
    params: z.object({ characterId: z.string().uuid() }),
    query: z.object({
        knowledgeBaseId: z.string().uuid().optional(),
        status: z.enum(["PENDING", "PROCESSING", "READY", "FAILED", "DELETED"]).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
});

export const getDocumentSchema = z.object({ params: z.object({ characterId: z.string().uuid(), documentId: z.string().uuid() }) });
export const deleteDocumentSchema = getDocumentSchema;

export const searchKnowledgeSchema = z.object({
    params: z.object({ characterId: z.string().uuid() }),
    query: z.object({
        q: z.string().min(1).max(500),
        knowledgeBaseId: z.string().uuid().optional(),
        topK: z.coerce.number().int().min(1).max(20).optional().default(10),
        topN: z.coerce.number().int().min(1).max(10).optional().default(5),
    }),
});
