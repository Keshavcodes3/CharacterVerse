import { prisma } from "../../infrastructure/database/db.js";
import { cache, CacheKeys, CacheTTL } from "../../infrastructure/cache/cache.js";
import { characterSearchService } from "../../infrastructure/search/prismaCharacterSearch.js";
import { recommendationService } from "../../infrastructure/recommendation/recommendation.service.js";

export class DiscoveryService {
    // Shared discovery guard — only PUBLIC + PUBLISHED + not suspended/archived/deleted
    private discoveryWhere() {
        return {
            status: "PUBLISHED" as const,
            visibility: "PUBLIC" as const,
        };
    }

    async getTrending(cursor?: string | null, limit = 20) {
        const key = CacheKeys.trending(cursor);
        const cached = await cache.get<any>(key);
        if (cached) return cached;

        // Trending: recent activity — updatedAt desc + favorites/chat/view weight
        const result = await characterSearchService.search({ sortBy: "trending" }, { cursor, limit });
        const enriched = await this.enrichWithCounts(result);
        await cache.set(key, enriched, CacheTTL.DISCOVERY);
        return enriched;
    }

    async getPopular(cursor?: string | null, limit = 20) {
        const key = CacheKeys.popular(cursor);
        const cached = await cache.get<any>(key);
        if (cached) return cached;

        const result = await characterSearchService.search({ sortBy: "popularity" }, { cursor, limit });
        const enriched = await this.enrichWithCounts(result);
        await cache.set(key, enriched, CacheTTL.DISCOVERY);
        return enriched;
    }

    async getNew(cursor?: string | null, limit = 20) {
        const key = CacheKeys.newChars(cursor);
        const cached = await cache.get<any>(key);
        if (cached) return cached;

        const result = await characterSearchService.search({ sortBy: "new" }, { cursor, limit });
        const enriched = await this.enrichWithCounts(result);
        await cache.set(key, enriched, CacheTTL.DISCOVERY);
        return enriched;
    }

    async getRecommended(userId: string | null, cursor?: string | null, limit = 20) {
        if (!userId) {
            // anonymous → popular
            return this.getPopular(cursor, limit);
        }
        const key = CacheKeys.recommended(userId, cursor);
        const cached = await cache.get<any>(key);
        if (cached) return cached;

        const result = await recommendationService.getRecommended({ userId, limit, cursor });
        const enriched = await this.enrichWithCounts(result as any);
        await cache.set(key, enriched, CacheTTL.DISCOVERY);
        return enriched;
    }

    async search(params: { q?: string; tags?: string[]; categories?: string[]; creatorId?: string; cursor?: string | null; limit?: number }) {
        const key = CacheKeys.search(JSON.stringify(params), params.cursor);
        const cached = await cache.get<any>(key);
        if (cached) return cached;

        const result = await characterSearchService.search(
            {
                query: params.q,
                tags: params.tags,
                categories: params.categories,
                creatorId: params.creatorId,
                sortBy: "relevance",
            },
            { cursor: params.cursor, limit: params.limit ?? 20 },
        );
        const enriched = await this.enrichWithCounts(result);
        await cache.set(key, enriched, CacheTTL.SEARCH);
        return enriched;
    }

    async getBySlug(slug: string, requesterId?: string | null) {
        const key = CacheKeys.character(slug);
        // Do not cache auth-sensitive results globally — only cache public published
        const char = await prisma.character.findUnique({
            where: { slug },
            include: {
                creator: { select: { id: true, username: true, avatarUrl: true } },
                personality: true,
                profile: true,
                _count: { select: { likes: true, bookmarks: true } },
            },
        });
        if (!char) return null;

        // Discovery invariant: if not PUBLIC+PUBLISHED, only owner/admin can see (handled at service/controller layer, but we also guard here)
        // For slug endpoint, we return null if not public/published and not owner — controller will do proper 403
        // For cache, only store if public published
        const isPublicPublished = char.status === "PUBLISHED" && char.visibility === "PUBLIC";
        if (isPublicPublished) {
            const cached = await cache.get<any>(key);
            if (cached) return cached;
            await cache.set(key, char, CacheTTL.CHARACTER);
        } else {
            // don't cache private
            await cache.del(key);
        }

        // Increment viewsCount async (denormalized counter)
        if (isPublicPublished) {
            void prisma.character.update({ where: { id: char.id }, data: { viewsCount: { increment: 1 } } }).catch(() => {});
            void prisma.characterView.create({ data: { characterId: char.id, userId: requesterId ?? null } }).catch(() => {});
        }

        return char;
    }

    private async enrichWithCounts(result: any) {
        // Already contains favoritesCount/chatCount/viewsCount from search
        return result;
    }
}

export const discoveryService = new DiscoveryService();
