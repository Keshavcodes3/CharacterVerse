export interface SearchFilters {
    query?: string; // text search
    tags?: string[];
    categories?: string[];
    creatorId?: string;
    sortBy?: "popularity" | "new" | "trending" | "relevance";
    // internal — discovery must only expose PUBLIC PUBLISHED NON-SUSPENDED
}

export interface CursorPage {
    cursor?: string | null;
    limit?: number;
}

export interface SearchResult {
    id: string;
    slug: string;
    name: string;
    description: string;
    tags: string[];
    category: string[];
    creatorId: string;
    favoritesCount: number;
    chatCount: number;
    viewsCount: number;
    createdAt: Date;
    updatedAt: Date;
    score?: number;
}

export interface SearchResponse {
    results: SearchResult[];
    nextCursor: string | null;
    hasMore: boolean;
}

export interface CharacterSearchService {
    search(filters: SearchFilters, page: CursorPage): Promise<SearchResponse>;
    indexCharacter(characterId: string): Promise<void>;
    removeCharacter(characterId: string): Promise<void>;
    // for testing
    isHealthy(): Promise<boolean>;
}
