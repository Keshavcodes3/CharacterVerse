import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { apiSuccess } from "../../utils/apiSuccess.js";
import { discoveryService } from "./discovery.service.js";

export class DiscoveryController {
    trending = asyncHandler(async (req: Request, res: Response) => {
        const { cursor, limit } = req.query as { cursor?: string; limit?: string };
        const result = await discoveryService.getTrending(cursor ?? null, limit ? parseInt(limit, 10) : 20);
        return apiSuccess(res, { message: "Trending characters", data: result.results, meta: { nextCursor: result.nextCursor, hasMore: result.hasMore } as any });
    });

    popular = asyncHandler(async (req: Request, res: Response) => {
        const { cursor, limit } = req.query as { cursor?: string; limit?: string };
        const result = await discoveryService.getPopular(cursor ?? null, limit ? parseInt(limit, 10) : 20);
        return apiSuccess(res, { message: "Popular characters", data: result.results, meta: { nextCursor: result.nextCursor, hasMore: result.hasMore } as any });
    });

    newChars = asyncHandler(async (req: Request, res: Response) => {
        const { cursor, limit } = req.query as { cursor?: string; limit?: string };
        const result = await discoveryService.getNew(cursor ?? null, limit ? parseInt(limit, 10) : 20);
        return apiSuccess(res, { message: "New characters", data: result.results, meta: { nextCursor: result.nextCursor, hasMore: result.hasMore } as any });
    });

    recommended = asyncHandler(async (req: Request, res: Response) => {
        const { cursor, limit } = req.query as { cursor?: string; limit?: string };
        const userId = (req as any).user?.id ?? null;
        const result = await discoveryService.getRecommended(userId, cursor ?? null, limit ? parseInt(limit, 10) : 20);
        return apiSuccess(res, { message: "Recommended characters", data: result.results, meta: { nextCursor: result.nextCursor, hasMore: result.hasMore } as any });
    });

    search = asyncHandler(async (req: Request, res: Response) => {
        const { q, tags, categories, creatorId, cursor, limit } = req.query as {
            q?: string;
            tags?: string;
            categories?: string;
            creatorId?: string;
            cursor?: string;
            limit?: string;
        };
        const tagArray = tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
        const catArray = categories ? categories.split(",").map((c) => c.trim()).filter(Boolean) : undefined;
        const result = await discoveryService.search({
            q,
            tags: tagArray,
            categories: catArray,
            creatorId,
            cursor: cursor ?? null,
            limit: limit ? parseInt(limit, 10) : 20,
        });
        return apiSuccess(res, { message: "Search results", data: result.results, meta: { nextCursor: result.nextCursor, hasMore: result.hasMore } as any });
    });

    getBySlug = asyncHandler(async (req: Request, res: Response) => {
        const { slug } = req.params as { slug: string };
        const requesterId = (req as any).user?.id ?? null;
        const char = await discoveryService.getBySlug(slug, requesterId);
        if (!char) return apiSuccess(res, { statusCode: 404, message: "Character not found" } as any);

        // Authz: private/suspended/archived only visible to owner/admin
        const isOwner = char.creatorId === requesterId;
        const isAdmin = (req as any).user?.role === "ADMIN" || (req as any).user?.role === "OWNER";
        if (char.visibility === "PRIVATE" && !isOwner && !isAdmin) return apiSuccess(res, { statusCode: 403, message: "Private character" } as any);
        if (char.status !== "PUBLISHED" && !isOwner && !isAdmin) return apiSuccess(res, { statusCode: 403, message: "Character not available" } as any);

        return apiSuccess(res, { message: "Character", data: char });
    });
}
