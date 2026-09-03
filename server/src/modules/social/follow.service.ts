import { prisma } from "../../infrastructure/database/db.js";
import { ApiError } from "../../utils/apiError.js";

export class FollowService {
    async follow(followerId: string, followingId: string) {
        if (followerId === followingId) throw new ApiError(400, "Cannot follow yourself", "SELF_FOLLOW");
        // ensure both users exist
        const [a, b] = await Promise.all([
            prisma.user.findUnique({ where: { id: followingId }, select: { id: true } }),
            prisma.user.findUnique({ where: { id: followerId }, select: { id: true } }),
        ]);
        if (!a) throw new ApiError(404, "User to follow not found", "USER_NOT_FOUND");
        if (!b) throw new ApiError(404, "Follower not found", "USER_NOT_FOUND");

        try {
            await prisma.follow.create({ data: { followerId, followingId } });
            return { following: true };
        } catch (e: any) {
            if (e.code === "P2002") {
                // idempotent
                return { following: true, already: true };
            }
            throw e;
        }
    }

    async unfollow(followerId: string, followingId: string) {
        await prisma.follow.deleteMany({ where: { followerId, followingId } });
        return { following: false };
    }

    async isFollowing(followerId: string, followingId: string) {
        const exists = await prisma.follow.findUnique({ where: { followerId_followingId: { followerId, followingId } } });
        return !!exists;
    }

    async getFollowers(userId: string, cursor?: string | null, limit = 20) {
        const take = Math.min(limit, 50);
        // cursor is follow.id
        const where: any = { followingId: userId };
        if (cursor) where.id = { gt: cursor };
        const rows = await prisma.follow.findMany({
            where,
            take: take + 1,
            orderBy: { createdAt: "desc" },
            include: { follower: { select: { id: true, username: true, avatarUrl: true, bio: true } } },
        });
        const hasMore = rows.length > take;
        const data = hasMore ? rows.slice(0, take) : rows;
        const nextCursor = hasMore ? data[data.length - 1].id : null;
        return { data: data.map((r) => r.follower), nextCursor, hasMore };
    }

    async getFollowing(userId: string, cursor?: string | null, limit = 20) {
        const take = Math.min(limit, 50);
        const where: any = { followerId: userId };
        if (cursor) where.id = { gt: cursor };
        const rows = await prisma.follow.findMany({
            where,
            take: take + 1,
            orderBy: { createdAt: "desc" },
            include: { following: { select: { id: true, username: true, avatarUrl: true, bio: true } } },
        });
        const hasMore = rows.length > take;
        const data = hasMore ? rows.slice(0, take) : rows;
        const nextCursor = hasMore ? data[data.length - 1].id : null;
        return { data: data.map((r) => r.following), nextCursor, hasMore };
    }
}

export const followService = new FollowService();
