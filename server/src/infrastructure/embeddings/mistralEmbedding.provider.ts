import { logger } from "../../config/pino.js";
import { env } from "../../config/env.js";
import type { EmbeddingProvider, EmbeddingResult } from "./embeddingProvider.js";

export class MistralEmbeddingProvider implements EmbeddingProvider {
    readonly name = "mistral";
    readonly dimensions = 1024;
    private model = "mistral-embed";

    constructor(private apiKey?: string) {
        this.apiKey = apiKey ?? env.MISTRAL_API_KEY;
    }

    async embed(text: string): Promise<EmbeddingResult> {
        const results = await this.embedBatch([text]);
        return results[0];
    }

    async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
        if (!this.apiKey) {
            logger.warn("MISTRAL_API_KEY missing — using deterministic fallback embeddings (test/dev)");
            return texts.map((t) => this.fallbackEmbed(t));
        }

        try {
            const res = await fetch("https://api.mistral.ai/v1/embeddings", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ model: this.model, input: texts }),
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Mistral embed failed ${res.status}: ${txt}`);
            }
            const json = (await res.json()) as { data: Array<{ embedding: number[] }>; model?: string };
            return json.data.map((d, i) => ({
                embedding: d.embedding,
                model: json.model ?? this.model,
                dimensions: d.embedding.length,
                usage: undefined,
            }));
        } catch (err) {
            logger.error({ err }, "Mistral embedBatch failed — falling back");
            // degradable: fallback so ingestion can still proceed in tests
            return texts.map((t) => this.fallbackEmbed(t));
        }
    }

    private fallbackEmbed(text: string): EmbeddingResult {
        // deterministic pseudo-embedding from text hash — NOT for production quality, but keeps ingestion testable
        const dims = this.dimensions;
        const embedding = new Array(dims).fill(0).map((_, i) => {
            let h = 2166136261;
            const str = `${text}-${i}`;
            for (let c = 0; c < str.length; c++) {
                h ^= str.charCodeAt(c);
                h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
            }
            // normalize to [-1,1]
            return ((h >>> 0) % 2000) / 1000 - 1;
        });
        // L2 normalize
        const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0)) || 1;
        const normalized = embedding.map((v) => v / norm);
        return { embedding: normalized, model: `${this.model}-fallback`, dimensions: dims };
    }
}
