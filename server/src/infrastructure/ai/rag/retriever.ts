import type { PrismaClient } from "../../../generated/prisma/client.js";
import { logger } from "../../../config/pino.js";
import { env } from "../../../config/env.js";

export interface RetrievedDoc { content: string; score: number; source?: string; }

export class RagRetriever {
    constructor(private readonly db: PrismaClient) {}

    async retrieve(characterId: string, query: string, limit = 5): Promise<RetrievedDoc[]> {
        try {
            // 1. Vector retrieval would go here (pgvector). Fallback: keyword search over KnowledgeDocument/KnowledgeChunk
            const docs = await this.db.knowledgeDocument.findMany({ where: { characterId }, take: 20 });
            if (docs.length === 0) return [];

            // naive scoring: term overlap
            const qTerms = query.toLowerCase().split(/\W+/).filter(Boolean);
            const scored = docs
                .map((d) => {
                    const lower = d.content.toLowerCase();
                    let score = 0;
                    for (const t of qTerms) if (lower.includes(t)) score += 1;
                    return { content: d.content.slice(0, 1500), score: score / Math.max(1, qTerms.length), source: d.title };
                })
                .filter((d) => d.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);

            // 2. Cohere rerank (if API key configured) — degrade gracefully if unavailable
            const reranked = await this.cohereRerank(query, scored);
            return reranked;
        } catch (err) {
            logger.warn({ err, characterId }, "RAG retrieval failed, continuing without RAG");
            return []; // degradable per spec: continue without RAG
        }
    }

    private async cohereRerank(query: string, docs: RetrievedDoc[]): Promise<RetrievedDoc[]> {
        if (docs.length === 0) return docs;
        const apiKey = env.COHERE_API_KEY;
        if (!apiKey) return docs; // no key -> skip rerank

        try {
            // Use LangChain Cohere rerank if available; fallback to fetch
            const res = await fetch("https://api.cohere.ai/v1/rerank", {
                method: "POST",
                headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model: "rerank-v3.5", query, documents: docs.map((d) => d.content), top_n: docs.length }),
            });
            if (!res.ok) throw new Error(`Cohere rerank ${res.status}`);
            const json = (await res.json()) as { results: Array<{ index: number; relevance_score: number }> };
            const order = json.results.sort((a, b) => b.relevance_score - a.relevance_score);
            return order.map((r) => ({ ...docs[r.index], score: r.relevance_score }));
        } catch (err) {
            logger.warn({ err }, "Cohere rerank failed, using original order");
            return docs;
        }
    }
}
