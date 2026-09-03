export interface CreateCharacterDTO {
    creatorId: string;
    name: string;
    slug?: string;
    description: string;
    greeting: string;
    avatarUrl?: string | null;
    visibility?: "PUBLIC" | "UNLISTED" | "PRIVATE";
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
    visibility?: "PUBLIC" | "UNLISTED" | "PRIVATE";
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
}
