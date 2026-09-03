export interface EmbeddingResult {
    embedding: number[];
    model: string;
    dimensions: number;
    usage?: { tokens?: number };
}

export interface EmbeddingProvider {
    readonly name: string;
    readonly dimensions: number;
    embed(text: string): Promise<EmbeddingResult>;
    embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
}
