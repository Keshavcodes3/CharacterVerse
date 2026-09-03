import { prisma } from "../database/db.js";
import { logger } from "../../config/pino.js";
import type { VectorStore, VectorSearchParams, VectorSearchResult } from "./vectorStore.js";

/**
 * Production vector store abstraction.
 * Primary: pgvector cosine similarity via raw SQL if `vector` extension available.
 * Fallback: in-memory cosine on loaded embeddings (for dev/tests without pgvector).
 */
export class PgVectorStore implements VectorStore {
    async upsert(chunks: Array<{ id: string; embedding: number[] }>): Promise<void> {
        // Embeddings are already persisted in KnowledgeChunk.embedding via Prisma.
        // This method is a no-op for pgvector where embedding column is source of truth.
        // Kept for interface compatibility with external vector DBs (pinecone/qdrant).
        logger.debug({ count: chunks.length }, "VectorStore upsert (pgvector col is source)");
        // If using external store, implement here.
        return;
    }

    async search(params: VectorSearchParams): Promise<VectorSearchResult[]> {
        const { characterId, knowledgeBaseId, queryEmbedding, topK } = params;

        // Try pgvector SQL first
        try {
            const kbFilter = knowledgeBaseId ? `AND "knowledgeBaseId" = '${knowledgeBaseId}'` : "";
            // Use Prisma $queryRawUnsafe with vector literal. pgvector expects '[1,2,3]'::vector
            const vectorLiteral = `[${queryEmbedding.join(",")}]`;
            // cosine distance operator <=> (distance). Score = 1 - distance
            const rows = (await prisma.$queryRawUnsafe(
                `SELECT id, "documentId", "knowledgeBaseId", "characterId", content, "chunkIndex", page, section, metadata,
                        1 - (embedding <=> $1::vector) as score
                 FROM "KnowledgeChunk"
                 WHERE "characterId" = $2 ${kbFilter}
                   AND embedding IS NOT NULL
                 ORDER BY embedding <=> $1::vector
                 LIMIT $3`,
                vectorLiteral,
                characterId,
                topK,
            )) as Array<VectorSearchResult & { score: number }>;

            if (rows && rows.length > 0) {
                return rows.map((r) => ({ ...r, score: Number(r.score) }));
            }
        } catch (err) {
            logger.warn({ err, characterId }, "pgvector search failed — falling back to in-memory");
        }

        // Fallback: load chunks and cosine in JS (still enforces ownership filtering)
        const where: Record<string, unknown> = { characterId };
        if (knowledgeBaseId) (where as Record<string, unknown>).knowledgeBaseId = knowledgeBaseId;
        const chunks = await prisma.knowledgeChunk.findMany({
            where: where as never,
            take: 500,
            select: { id: true, documentId: true, knowledgeBaseId: true, characterId: true, content: true, chunkIndex: true, page: true, section: true, metadata: true, embedding: true },
        });

        const scored = chunks
            .filter((c) => c.embedding)
            .map((c) => {
                const emb = c.embedding as unknown as number[] | string;
                let vec: number[] | null = null;
                if (Array.isArray(emb)) vec = emb;
                else if (typeof emb === "string") {
                    try { vec = JSON.parse(emb); } catch { vec = null; }
                }
                if (!vec) return null;
                const score = cosineSimilarity(queryEmbedding, vec);
                return { chunkId: c.id, documentId: c.documentId, knowledgeBaseId: c.knowledgeBaseId as string | null, characterId: c.characterId, content: c.content, chunkIndex: c.chunkIndex, page: c.page, section: c.section, metadata: c.metadata as Record<string, unknown> | null, score };
            })
            .filter(Boolean) as VectorSearchResult[];

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
    }

    async deleteByDocument(documentId: string): Promise<void> {
        // Chunks cascade deleted via FK, but ensure vectors cleared
        await prisma.knowledgeChunk.deleteMany({ where: { documentId } });
        logger.info({ documentId }, "Vector entries deleted for document");
    }

    async deleteByKnowledgeBase(knowledgeBaseId: string): Promise<void> {
        await prisma.knowledgeChunk.deleteMany({ where: { knowledgeBaseId } });
        logger.info({ knowledgeBaseId }, "Vector entries deleted for knowledgeBase");
    }

    async deleteByIds(ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        await prisma.knowledgeChunk.deleteMany({ where: { id: { in: ids } } });
    }
}

function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0; let na = 0; let nb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
