import type { PrismaClient } from "../../generated/prisma/client.js";

export class CharacterVersionRepository {
    constructor(private readonly db: PrismaClient) {}

    async createVersion(params: {
        characterId: string;
        version: number;
        name: string;
        description: string;
        greeting: string;
        avatarUrl?: string | null;
        personalitySnapshot: unknown;
        profileSnapshot?: unknown;
        examplesSnapshot?: unknown;
        tags: string[];
        category: string[];
        createdBy?: string;
    }) {
        return this.db.characterVersion.create({
            data: {
                characterId: params.characterId,
                version: params.version,
                name: params.name,
                description: params.description,
                greeting: params.greeting,
                avatarUrl: params.avatarUrl ?? null,
                personalitySnapshot: params.personalitySnapshot as never,
                profileSnapshot: (params.profileSnapshot as never) ?? null,
                examplesSnapshot: (params.examplesSnapshot as never) ?? null,
                tags: params.tags,
                category: params.category,
                createdBy: params.createdBy,
            },
        });
    }

    async getVersion(characterId: string, version: number) {
        return this.db.characterVersion.findUnique({ where: { characterId_version: { characterId, version } } });
    }

    async getCurrent(characterId: string) {
        const char = await this.db.character.findUnique({
            where: { id: characterId },
            include: { currentVersion: true },
        });
        return char?.currentVersion ?? null;
    }

    async listVersions(characterId: string) {
        return this.db.characterVersion.findMany({
            where: { characterId },
            orderBy: { version: "desc" },
        });
    }
}
