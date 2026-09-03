import { prisma } from "../database/db.js";
import { logger } from "../../config/pino.js";
import type { CharacterSearchService, SearchFilters, CursorPage, SearchResponse } from "./characterSearch.service.js";

/**
 * Infrastructure implementation — Prisma-backed.
 * Do not couple domain to Elasticsearch/OpenSearch; this can be swapped with ElasticSearch adapter implementing same interface.
 * Enforces discovery invariant: only PUBLIC + PUBLISHED + not SUSPENDED/DELETED/ARCHIVED
 */
export class PrismaCharacterSearch implements CharacterSearchService {
    async isHealthy(): Promise<boolean> {
        try {
            await prisma.character.count({ where: { status: "PUBLISHED" } });
            return true;
        } catch {
            return false;
        }
    }

    async indexCharacter(characterId: string): Promise<void> {
        // No external index to update for Prisma — idempotent no-op.
        // In Elastic implementation, this would upsert. Kept for interface + outbox idempotence.
        logger.debug({ characterId }, "PrismaCharacterSearch indexCharacter (no-op)");
    }

    async removeCharacter(characterId: string): Promise<void> {
        logger.debug({ characterId }, "PrismaCharacterSearch removeCharacter (no-op)");
    }

    async search(filters: SearchFilters, page: CursorPage): Promise<SearchResponse> {
        const limit = Math.min(Math.max(page.limit ?? 20, 1), 50);
        const cursor = page.cursor ?? null;

        // Discovery invariant — never expose private/suspended/archived
        const where: any = {
            status: "PUBLISHED",
            visibility: "PUBLIC",
        };

        if (filters.creatorId) where.creatorId = filters.creatorId;
        if (filters.tags?.length) where.tags = { hasSome: filters.tags };
        if (filters.categories?.length) where.category = { hasSome: filters.categories };

        // text search: name, description, tags, categories
        if (filters.query) {
            const q = filters.query.trim();
            if (q) {
                where.OR = [
                    { name: { contains: q, mode: "insensitive" } },
                    { description: { contains: q, mode: "insensitive" } },
                    { tags: { has: q.toLowerCase() } },
                ];
            }
        }

        // cursor pagination — avoid offset for large datasets
        // cursor is base64 encoded `createdAt_id` or `favoritesCount_id` depending on sort
        const orderBy = this.getOrderBy(filters.sortBy);
        const cursorWhere = cursor ? this.decodeCursor(cursor, filters.sortBy) : null;
        const finalWhere = cursorWhere ? { ...where, ...cursorWhere } : where;

        const raw = await prisma.character.findMany({
            where: finalWhere,
            orderBy,
            take: limit + 1,
            select: {
                id: true, slug: true, name: true, description: true, tags: true, category: true,
                creatorId: true, favoritesCount: true, chatCount: true, viewsCount: true,
                createdAt: true, updatedAt: true, publishedAt: true,
            },
        });

        const hasMore = raw.length > limit;
        const results = hasMore ? raw.slice(0, limit) : raw;
        const nextCursor = hasMore ? this.encodeCursor(results[results.length - 1], filters.sortBy) : null;

        return {
            results: results.map((r) => ({
                id: r.id, slug: r.slug, name: r.name, description: r.description,
                tags: r.tags, category: r.category, creatorId: r.creatorId,
                favoritesCount: r.favoritesCount, chatCount: r.chatCount, viewsCount: r.viewsCount,
                createdAt: r.createdAt, updatedAt: r.updatedAt,
            })),
            nextCursor,
            hasMore,
        };
    }

    private getOrderBy(sortBy?: string): any {
        switch (sortBy) {
            case "popularity":
                return [{ favoritesCount: "desc" }, { chatCount: "desc" }, { id: "asc" }];
            case "trending":
                // trending: recent views + chats — order by updatedAt + favorites
                return [{ updatedAt: "desc" }, { favoritesCount: "desc" }, { id: "asc" }];
            case "new":
                return [{ publishedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }];
            case "relevance":
            default:
                return [{ favoritesCount: "desc" }, { createdAt: "desc" }, { id: "asc" }];
        }
    }

    private encodeCursor(last: any, sortBy?: string): string {
        // encode last sort value + id for stable pagination
        let payload: Record<string, string>;
        switch (sortBy) {
            case "popularity":
                payload = { fav: String(last.favoritesCount), id: last.id };
                break;
            case "new":
                payload = { createdAt: last.createdAt.toISOString(), id: last.id };
                break;
            case "trending":
                payload = { updatedAt: last.updatedAt.toISOString(), id: last.id };
                break;
            default:
                payload = { fav: String(last.favoritesCount), createdAt: last.createdAt.toISOString(), id: last.id };
        }
        return Buffer.from(JSON.stringify(payload)).toString("base64url");
    }

    private decodeCursor(cursor: string, sortBy?: string): any {
        try {
            const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
            // We need WHERE ... < / > last value — for desc order, we want items *after* cursor (less than)
            // Handle composite cursor: (favoritesCount < lastFav) OR (favoritesCount = lastFav AND id > lastId)
            // Simplified: use id > lastId with secondary filter — approximate but safe with orderBy
            // Better: build OR compound for true cursor.
            if (sortBy === "popularity") {
                const fav = parseInt(payload.fav, 10);
                const id = payload.id;
                return {
                    OR: [
                        { favoritesCount: { lt: fav } },
                        { favoritesCount: fav, id: { gt: id } },
                    ],
                };
            }
            if (sortBy === "new") {
                return { createdAt: { lt: new Date(payload.createdAt) } };
            }
            if (sortBy === "trending") {
                return { updatedAt: { lt: new Date(payload.updatedAt) } };
            }
            // relevance default
            const fav = parseInt(payload.fav, 10);
            return {
                OR: [
                    { favoritesCount: { lt: fav } },
                    { favoritesCount: fav, createdAt: { lt: new Date(payload.createdAt) } },
                    { favoritesCount: fav, createdAt: new Date(payload.createdAt), id: { gt: payload.id } },
                ],
            };
        } catch {
            return null;
        }
    }
}

export const characterSearchService: CharacterSearchService = new PrismaCharacterSearch();
