import { prisma } from "../database/db.js";
import { logger } from "../../config/pino.js";
import type { EmbeddingProvider } from "../embeddings/embeddingProvider.js";
import type { VectorStore } from "../vector/vectorStore.js";
import { CohereReranker } from "./reranker.js";

export interface RelevantKnowledge {
    content: string;
    score: number;
    documentId: string;
    chunkId: string;
    source?: string | null;
    metadata?: Record<string, unknown> | null;
}

export class RetrievalService {
    constructor(
        private embeddingProvider: EmbeddingProvider,
        private vectorStore: VectorStore,
        private reranker: CohereReranker,
    ) {}

    /**
     * Agent integration point per spec §7 — expose retrieveRelevantKnowledge()
     * Always filtered by character/knowledgeBase ownership (tenant isolation)
     */
    async retrieveRelevantKnowledge(params: {
        characterId: string;
        knowledgeBaseId?: string | null;
        query: string;
        topK?: number;
        topN?: number;
        minScore?: number;
    }): Promise<RelevantKnowledge[]> {
        const { characterId, knowledgeBaseId, query, topK = 20, topN = 5, minScore = 0.15 } = params;
        if (!query?.trim()) return [];
        const t0 = Date.now();
        try {
            const emb = await this.embeddingProvider.embed(query);
            const candidates = await this.vectorStore.search({ characterId, knowledgeBaseId: knowledgeBaseId ?? null, queryEmbedding: emb.embedding, topK });

            // filter by score before rerank to save cost
            const filtered = candidates.filter((c) => c.score >= minScore);
            const toRerank = filtered.length ? filtered : candidates.slice(0, Math.min(10, candidates.length));

            if (toRerank.length === 0) {
                logger.info({ characterId, query: query.slice(0, 60) }, "RAG: no candidates");
                return [];
            }

            const reranked = await this.reranker.rerank({
                query,
                documents: toRerank.map((c) => ({ content: c.content, id: c.chunkId, score: c.score })),
                topN,
            });

            const result: RelevantKnowledge[] = reranked.map((r) => {
                const orig = toRerank[r.index];
                return { content: r.content, score: r.score, documentId: orig.documentId, chunkId: orig.chunkId, source: orig.metadata?.source as string | null ?? null, metadata: orig.metadata };
            });

            logger.info({ characterId, knowledgeBaseId, query: query.slice(0, 60), candidates: candidates.length, reranked: result.length, latency: Date.now() - t0, topN }, "RAG retrieve");
            return result;
        } catch (err) {
            logger.warn({ err, characterId }, "RAG retrieval failed — degradable, returning []");
            return [];
        }
    }
}
