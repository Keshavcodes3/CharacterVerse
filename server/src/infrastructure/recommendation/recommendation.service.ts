import { prisma } from "../database/db.js";
import { logger } from "../../config/pino.js";
import { characterSearchService } from "../search/prismaCharacterSearch.js";

/**
 * RecommendationService abstraction per spec §8.
 * Initial implementation uses simple signals — extensible to ML.
 * Signals: chatCount, favoritesCount, viewsCount, recent activity, category, tags.
 */
export interface RecommendationFilters {
    userId?: string;
    limit?: number;
    cursor?: string | null;
}

export class RecommendationService {
    async getRecommended(filters: RecommendationFilters) {
        const limit = Math.min(filters.limit ?? 20, 50);

        // If user is known, boost categories/tags they have interacted with (liked + chatted)
        let preferredTags: string[] = [];
        let preferredCategories: string[] = [];

        if (filters.userId) {
            try {
                const [likes, chats] = await Promise.all([
                    prisma.like.findMany({ where: { userId: filters.userId }, take: 20, include: { character: { select: { tags: true, category: true } } } }),
                    prisma.conversation.findMany({ where: { userId: filters.userId }, take: 20, include: { character: { select: { tags: true, category: true } } } }),
                ]);
                const tagCounts = new Map<string, number>();
                const catCounts = new Map<string, number>();
                for (const l of likes) {
                    for (const t of l.character.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 2);
                    for (const c of l.character.category) catCounts.set(c, (catCounts.get(c) ?? 0) + 2);
                }
                for (const ch of chats) {
                    if (!ch.character) continue;
                    for (const t of ch.character.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
                    for (const c of ch.character.category) catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
                }
                preferredTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
                preferredCategories = [...catCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
            } catch (e) {
                logger.warn({ err: e }, "Recommendation preference load failed");
            }
        }

        // If we have preferences, search with them — else fallback to trending/popular mix
        if (preferredTags.length || preferredCategories.length) {
            try {
                const res = await characterSearchService.search(
                    { tags: preferredTags, categories: preferredCategories, sortBy: "popularity" },
                    { cursor: filters.cursor, limit },
                );
                if (res.results.length >= 5) return res;
                // fill remainder with popular
            } catch (e) {
                logger.warn({ err: e }, "Recommendation search failed");
            }
        }

        // Fallback: popular
        return characterSearchService.search({ sortBy: "popularity" }, { cursor: filters.cursor, limit });
    }
}

export const recommendationService = new RecommendationService();
