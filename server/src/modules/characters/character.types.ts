import type { Character, CharacterPersonality, CharacterExample } from "../../generated/prisma/client.js";

export type Visibility = "PUBLIC" | "UNLISTED" | "PRIVATE";

export interface CharacterWithRelations extends Character {
    personality?: CharacterPersonality | null;
    examples?: CharacterExample[];
    creator?: { id: string; username: string; avatarUrl: string | null };
    _count?: { likes: number; bookmarks: number };
}

export interface CharacterListFilters {
    page: number;
    limit: number;
    search?: string;
    category?: string;
    tags?: string[];
    visibility?: Visibility;
    creatorId?: string;
    sortBy: "createdAt" | "updatedAt" | "name";
    order: "asc" | "desc";
}

export interface PaginatedCharacters {
    data: CharacterWithRelations[];
    meta: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export interface CreateCharacterDTO {
    creatorId: string;
    name: string;
    slug?: string;
    description: string;
    greeting: string;
    avatarUrl?: string | null;
    visibility?: Visibility;
    category?: string[];
    tags?: string[];
    personality?: {
        traits?: unknown;
        backstory?: string;
        personality?: string;
        lore?: string | null;
        knowledge?: string | null;
        scenario?: string | null;
        exampleDialogues?: unknown | null;
    };
    examples?: Array<{
        title?: string;
        content: string;
        isDialogue?: boolean;
    }>;
}

export interface UpdateCharacterDTO {
    name?: string;
    description?: string;
    greeting?: string;
    avatarUrl?: string | null;
    visibility?: Visibility;
    category?: string[];
    tags?: string[];
    personality?: {
        traits?: unknown;
        backstory?: string;
        personality?: string;
        lore?: string | null;
        knowledge?: string | null;
        scenario?: string | null;
        exampleDialogues?: unknown | null;
    };
    examples?: Array<{
        title?: string;
        content: string;
        isDialogue?: boolean;
    }>;
}
