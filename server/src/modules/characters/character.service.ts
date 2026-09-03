import crypto from "node:crypto";
import { ApiError } from "../../utils/apiError.js";
import type { CharacterRepository } from "./character.repository.js";
import type { CreateCharacterDTO, UpdateCharacterDTO, CharacterListFilters } from "./character.types.js";

function slugify(input: string): string {
    return input
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-")
        .slice(0, 80);
}

function generateUniqueSuffix(): string {
    return crypto.randomBytes(3).toString("hex"); // 6 chars
}

export class CharacterService {
    constructor(private readonly repo: CharacterRepository) {}

    private async ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
        let slug = base;
        let exists = await this.repo.slugExists(slug, excludeId);
        let attempts = 0;
        while (exists && attempts < 5) {
            slug = `${base}-${generateUniqueSuffix()}`;
            exists = await this.repo.slugExists(slug, excludeId);
            attempts++;
        }
        if (exists) {
            // fallback with timestamp
            slug = `${base}-${Date.now().toString(36)}`;
        }
        return slug;
    }

    async create(dto: CreateCharacterDTO) {
        const baseSlug = dto.slug ? slugify(dto.slug) : slugify(dto.name);
        if (!baseSlug) throw new ApiError(400, "Invalid slug derived from name", "INVALID_SLUG");
        const slug = await this.ensureUniqueSlug(baseSlug);

        const character = await this.repo.createWithRelations({
            creatorId: dto.creatorId,
            name: dto.name.trim(),
            slug,
            description: dto.description,
            greeting: dto.greeting,
            avatarUrl: dto.avatarUrl ?? null,
            visibility: dto.visibility ?? "PUBLIC",
            category: dto.category ?? [],
            tags: dto.tags ?? [],
            personality: dto.personality,
            examples: dto.examples,
        });

        return character;
    }

    async getByIdOrSlug(idOrSlug: string, requesterId?: string) {
        const character = await this.repo.findByIdOrSlug(idOrSlug);
        if (!character) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");

        // Visibility check - mirrors character.ai:
        // PUBLIC -> anyone
        // UNLISTED -> anyone with link (no visibility filter)
        // PRIVATE -> only creator (or admin via future role check)
        if (character.visibility === "PRIVATE" && character.creatorId !== requesterId) {
            throw new ApiError(403, "This character is private", "FORBIDDEN");
        }

        return character;
    }

    async list(filters: CharacterListFilters, requesterId?: string) {
        // Non-owners should only see PUBLIC characters
        // If user is authenticated and filters.creatorId === requesterId, allow UNLISTED/PRIVATE
        const effectiveVisibility = (() => {
            // If requesting own characters explicitly, show all visibilities for that user
            if (filters.creatorId && filters.creatorId === requesterId) return undefined;
            // If visibility param set, respect it only if public or owner; otherwise force PUBLIC
            if (filters.visibility) {
                if (filters.visibility === "PUBLIC") return "PUBLIC";
                // private/unlisted requires ownership context - if no creatorId filter and not owner, deny
                if (!requesterId) return "PUBLIC";
                // If requester is querying general list with PRIVATE, restrict to their own via fallback
                // Instead force PUBLIC for general discovery
                return "PUBLIC";
            }
            // Default discovery -> PUBLIC only
            // If listing own characters (creatorId == requesterId) we've already returned undefined
            if (filters.creatorId) return undefined; // respect all if filtering by creator, but we filtered above
            return "PUBLIC" as const;
        })();

        const effectiveFilters: CharacterListFilters = {
            ...filters,
            visibility: effectiveVisibility as CharacterListFilters["visibility"],
            tags: filters.tags as unknown as string[] | undefined,
        };

        // Special case: if user is listing their own characters, include all visibilities
        if (filters.creatorId === requesterId) {
            delete (effectiveFilters as Partial<CharacterListFilters>).visibility;
        } else if (!filters.creatorId && effectiveVisibility === "PUBLIC") {
            effectiveFilters.visibility = "PUBLIC";
        }

        // Search tags comma separated handling if passed via query string as string
        return this.repo.list(effectiveFilters);
    }

    async listMyCharacters(userId: string, filters: Omit<CharacterListFilters, "creatorId" | "visibility">) {
        return this.repo.list({
            ...filters,
            creatorId: userId,
            visibility: undefined, // all visibilities for owner
        });
    }

    async update(idOrSlug: string, userId: string, dto: UpdateCharacterDTO) {
        const existing = await this.repo.findByIdOrSlug(idOrSlug);
        if (!existing) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        if (existing.creatorId !== userId) throw new ApiError(403, "Not authorized to update this character", "FORBIDDEN");

        const data: Record<string, unknown> = {};
        if (dto.name !== undefined) data.name = dto.name.trim();
        if (dto.description !== undefined) data.description = dto.description;
        if (dto.greeting !== undefined) data.greeting = dto.greeting;
        if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
        if (dto.visibility !== undefined) data.visibility = dto.visibility;
        if (dto.category !== undefined) data.category = dto.category;
        if (dto.tags !== undefined) data.tags = dto.tags;

        // Note: slug is immutable after creation to keep links stable (character.ai behavior)
        // If name changes we do not auto-update slug

        const updated = await this.repo.update(existing.id, data as never, dto.personality as never, dto.examples);
        return updated;
    }

    async delete(idOrSlug: string, userId: string) {
        const existing = await this.repo.findByIdOrSlug(idOrSlug);
        if (!existing) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        if (existing.creatorId !== userId) throw new ApiError(403, "Not authorized to delete this character", "FORBIDDEN");
        await this.repo.delete(existing.id);
    }

    async toggleLike(idOrSlug: string, userId: string) {
        const character = await this.repo.findByIdOrSlug(idOrSlug);
        if (!character) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        if (character.visibility === "PRIVATE" && character.creatorId !== userId) {
            throw new ApiError(403, "Cannot like a private character", "FORBIDDEN");
        }
        const liked = await this.repo.isLiked(userId, character.id);
        if (liked) {
            await this.repo.unlike(userId, character.id);
            return { liked: false, likesCount: await this.repo.countLikes(character.id) };
        } else {
            await this.repo.like(userId, character.id);
            return { liked: true, likesCount: await this.repo.countLikes(character.id) };
        }
    }

    async toggleBookmark(idOrSlug: string, userId: string) {
        const character = await this.repo.findByIdOrSlug(idOrSlug);
        if (!character) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        if (character.visibility === "PRIVATE" && character.creatorId !== userId) {
            throw new ApiError(403, "Cannot bookmark a private character", "FORBIDDEN");
        }
        const bookmarked = await this.repo.isBookmarked(userId, character.id);
        if (bookmarked) {
            await this.repo.unbookmark(userId, character.id);
            return { bookmarked: false };
        } else {
            await this.repo.bookmark(userId, character.id);
            return { bookmarked: true };
        }
    }

    async likeStatus(idOrSlug: string, userId: string) {
        const character = await this.repo.findByIdOrSlug(idOrSlug);
        if (!character) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        const [liked, bookmarked, likesCount] = await Promise.all([
            this.repo.isLiked(userId, character.id),
            this.repo.isBookmarked(userId, character.id),
            this.repo.countLikes(character.id),
        ]);
        return { liked, bookmarked, likesCount };
    }
}
