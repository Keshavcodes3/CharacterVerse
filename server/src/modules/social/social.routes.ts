import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/db.js";
import { validate } from "../../middleware/validation.middleware.js";
import { createAuthMiddleware } from "../auth/middleware/auth.middleware.js";
import { AuthRepository } from "../auth/repositories/auth.repository.js";
import { AuthService } from "../auth/services/auth.service.js";
import { favoriteService } from "./favorite.service.js";
import { followService } from "./follow.service.js";
import { reportService } from "./report.service.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { apiSuccess } from "../../utils/apiSuccess.js";

const authRepo = new AuthRepository(prisma);
const authService = new AuthService(authRepo);
const { requireAuth } = createAuthMiddleware(authService);

// optional auth for some reads
const optionalAuth: typeof requireAuth = async (req, _res, next) => {
    try {
        await new Promise<void>((resolve, reject) => requireAuth(req as any, _res as any, (err?: unknown) => (err ? reject(err) : resolve())));
        return next();
    } catch { return next(); }
};

const router = Router();

// Favorites (alias Like)
router.post("/characters/:id/favorite", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    // resolve character id from slug or id
    const char = await prisma.character.findFirst({ where: { OR: [{ id }, { slug: id }] }, select: { id: true } });
    if (!char) return apiSuccess(res, { statusCode: 404, message: "Character not found" } as any);
    const r = await favoriteService.favorite(userId, char.id);
    return apiSuccess(res, { message: r.already ? "Already favorited" : "Favorited", data: r });
}));

router.delete("/characters/:id/favorite", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    const char = await prisma.character.findFirst({ where: { OR: [{ id }, { slug: id }] }, select: { id: true } });
    if (!char) return apiSuccess(res, { statusCode: 404, message: "Character not found" } as any);
    const r = await favoriteService.unfavorite(userId, char.id);
    return apiSuccess(res, { message: "Unfavorited", data: r });
}));

router.get("/users/:userId/favorites", optionalAuth, asyncHandler(async (req, res) => {
    const { userId } = req.params as { userId: string };
    const { cursor, limit } = req.query as { cursor?: string; limit?: string };
    const result = await favoriteService.listFavorites(userId, cursor ?? null, limit ? parseInt(limit, 10) : 20);
    return apiSuccess(res, { message: "Favorites", data: result.data, meta: { nextCursor: result.nextCursor, hasMore: result.hasMore } as any });
}));

router.get("/me/favorites", requireAuth, asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { cursor, limit } = req.query as { cursor?: string; limit?: string };
    const result = await favoriteService.listFavorites(userId, cursor ?? null, limit ? parseInt(limit, 10) : 20);
    return apiSuccess(res, { message: "My favorites", data: result.data, meta: { nextCursor: result.nextCursor, hasMore: result.hasMore } as any });
}));

// Follow
router.post("/users/:id/follow", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    const r = await followService.follow(userId, id);
    return apiSuccess(res, { message: r.already ? "Already following" : "Followed", data: r });
}));

router.delete("/users/:id/follow", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    const r = await followService.unfollow(userId, id);
    return apiSuccess(res, { message: "Unfollowed", data: r });
}));

router.get("/users/:id/followers", asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const { cursor, limit } = req.query as { cursor?: string; limit?: string };
    const result = await followService.getFollowers(id, cursor ?? null, limit ? parseInt(limit, 10) : 20);
    return apiSuccess(res, { message: "Followers", data: result.data, meta: { nextCursor: result.nextCursor, hasMore: result.hasMore } as any });
}));

router.get("/users/:id/following", asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const { cursor, limit } = req.query as { cursor?: string; limit?: string };
    const result = await followService.getFollowing(id, cursor ?? null, limit ? parseInt(limit, 10) : 20);
    return apiSuccess(res, { message: "Following", data: result.data, meta: { nextCursor: result.nextCursor, hasMore: result.hasMore } as any });
}));

// Reports
const reportSchema = z.object({ body: z.object({ reason: z.enum(["SPAM","HARASSMENT","INAPPROPRIATE_CONTENT","IMPERSONATION","COPYRIGHT","OTHER"]), description: z.string().max(2000).optional().nullable(), metadata: z.record(z.string(), z.unknown()).optional() }) });

import { reportRateLimit } from "../../middleware/rate-limit.middleware.js";
router.post("/characters/:id/report", requireAuth, reportRateLimit, validate(reportSchema as any), asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    const { reason, description, metadata } = req.body as { reason: string; description?: string | null; metadata?: unknown };
    const char = await prisma.character.findFirst({ where: { OR: [{ id }, { slug: id }] }, select: { id: true } });
    if (!char) return apiSuccess(res, { statusCode: 404, message: "Character not found" } as any);
    const report = await reportService.report({ reporterId: userId, characterId: char.id, reason, description: description ?? null, metadata });
    return apiSuccess(res, { statusCode: 201, message: "Report submitted", data: { report } });
}));

export default router;
