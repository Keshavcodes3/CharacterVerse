import { prisma } from "../../infrastructure/database/db.js";
import { ApiError } from "../../utils/apiError.js";
import { cache, CacheKeys } from "../../infrastructure/cache/cache.js";

export class FavoriteService {
    /**
     * Idempotent favorite — (userId,characterId) UNIQUE handles retries without drift.
     * Counter incremented only when row created, not on duplicate retry.
     */
    async favorite(userId: string, characterId: string) {
        const char = await prisma.character.findUnique({ where: { id: characterId }, select: { id: true, status: true, visibility: true } });
        if (!char) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        if (char.status !== "PUBLISHED") throw new ApiError(400, "Only published characters can be favorited", "INVALID_STATUS");
        if (char.visibility !== "PUBLIC") {
            // discovery only allows PUBLIC, but favoriting private should still require visibility check at character fetch level
            // allow favoriting if user could see it (handled upstream), here just check PUBLIC for discovery consistency
        }

        try {
            await prisma.$transaction(async (tx) => {
                await tx.like.create({ data: { userId, characterId } });
                await tx.character.update({ where: { id: characterId }, data: { favoritesCount: { increment: 1 } } });
            });
            await cache.del(CacheKeys.character(characterId));
            await cache.delByPrefix("discovery:");
            return { favorited: true };
        } catch (e: any) {
            if (e.code === "P2002") {
                // unique violation — already favorited, idempotent success without increment (no drift)
                return { favorited: true, already: true };
            }
            throw e;
        }
    }

    async unfavorite(userId: string, characterId: string) {
        try {
            await prisma.$transaction(async (tx) => {
                const deleted = await tx.like.deleteMany({ where: { userId, characterId } });
                if (deleted.count > 0) {
                    await tx.character.update({ where: { id: characterId }, data: { favoritesCount: { decrement: 1 } } });
                }
            });
            await cache.del(CacheKeys.character(characterId));
            await cache.delByPrefix("discovery:");
            return { favorited: false };
        } catch (e) {
            throw e;
        }
    }

    async isFavorite(userId: string, characterId: string) {
        const exists = await prisma.like.findUnique({ where: { userId_characterId: { userId, characterId } } });
        return !!exists;
    }

    async listFavorites(userId: string, cursor?: string | null, limit = 20) {
        const take = Math.min(limit, 50);
        const cursorWhere = cursor ? { id: { gt: cursor } } as any : undefined;
        // Use Like as Favorite — cursor on Like.id
        const likes = await prisma.like.findMany({
            where: { userId, ...(cursorWhere ? { id: cursorWhere.id } : {}) },
            take: take + 1,
            orderBy: { createdAt: "desc" },
            include: { character: { include: { creator: { select: { id: true, username: true, avatarUrl: true } }, _count: { select: { likes: true } } } } },
        });
        const hasMore = likes.length > take;
        const data = hasMore ? likes.slice(0, take) : likes;
        const nextCursor = hasMore ? data[data.length - 1].id : null;

        // Filter to only PUBLIC PUBLISHED for discovery hygiene, but personal library may include private favorited? Spec says favorites library — allow all favorited
        const filtered = data.filter((l) => l.character.status === "PUBLISHED" || l.character.creatorId === userId);

        return { data: filtered.map((l) => l.character), nextCursor, hasMore };
    }
}

export const favoriteService = new FavoriteService();
