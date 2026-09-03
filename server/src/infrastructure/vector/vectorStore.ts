export interface VectorSearchParams {
    characterId: string;
    knowledgeBaseId?: string | null;
    queryEmbedding: number[];
    topK: number;
    minScore?: number;
}

export interface VectorSearchResult {
    chunkId: string;
    documentId: string;
    knowledgeBaseId: string | null;
    characterId: string;
    content: string;
    score: number; // 0-1
    metadata?: Record<string, unknown> | null;
    chunkIndex: number;
    page?: number | null;
    section?: string | null;
}

export interface VectorStore {
    upsert(chunks: Array<{ id: string; embedding: number[]; metadata?: Record<string, unknown> }>): Promise<void>;
    search(params: VectorSearchParams): Promise<VectorSearchResult[]>;
    deleteByDocument(documentId: string): Promise<void>;
    deleteByKnowledgeBase(knowledgeBaseId: string): Promise<void>;
    deleteByIds(ids: string[]): Promise<void>;
}
