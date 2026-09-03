import { logger } from "../../config/pino.js";
import { env } from "../../config/env.js";

export interface RerankInput {
    query: string;
    documents: Array<{ content: string; id?: string; score?: number }>;
    topN?: number;
}

export interface RerankedDoc {
    index: number;
    score: number;
    content: string;
    id?: string;
}

export class CohereReranker {
    private model = "rerank-v3.5";
    constructor(private apiKey?: string) {
        this.apiKey = apiKey ?? env.COHERE_API_KEY;
    }

    async rerank(input: RerankInput): Promise<RerankedDoc[]> {
        const { query, documents, topN } = input;
        if (documents.length === 0) return [];

        if (!this.apiKey) {
            logger.debug("COHERE_API_KEY missing — skipping rerank, returning original order");
            return documents.map((d, i) => ({ index: i, score: d.score ?? 1 - i * 0.01, content: d.content, id: d.id })).slice(0, topN ?? documents.length);
        }

        try {
            const res = await fetch("https://api.cohere.ai/v1/rerank", {
                method: "POST",
                headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model: this.model, query, documents: documents.map((d) => d.content), top_n: topN ?? documents.length, max_chunks_per_doc: 1 }),
            });

            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Cohere rerank ${res.status}: ${txt}`);
            }

            const json = (await res.json()) as { results: Array<{ index: number; relevance_score: number }> };
            const mapped: RerankedDoc[] = json.results
                .sort((a, b) => b.relevance_score - a.relevance_score)
                .map((r) => ({ index: r.index, score: r.relevance_score, content: documents[r.index].content, id: documents[r.index].id }));
            return mapped;
        } catch (err) {
            logger.warn({ err, query: query.slice(0, 80) }, "Cohere rerank failed — degradable fallback to vector order");
            // degradable per spec §6: return original when safe
            return documents.map((d, i) => ({ index: i, score: d.score ?? 1 - i * 0.01, content: d.content, id: d.id })).slice(0, topN ?? documents.length);
        }
    }
}
