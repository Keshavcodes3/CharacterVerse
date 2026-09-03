import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError.js";
import { isRateLimited } from "../infrastructure/rateLimit/redisRateLimiter.js";

export function rateLimit(opts: { windowMs: number; max: number; key: (req: Request) => string; message?: string }) {
    return async (req: Request, _res: Response, next: NextFunction) => {
        const k = opts.key(req);
        try {
            const result = await isRateLimited({ key: k, windowMs: opts.windowMs, max: opts.max });
            _res.setHeader("X-RateLimit-Remaining", String(result.remaining));
            _res.setHeader("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
            if (result.limited) return next(new ApiError(429, opts.message ?? "Too many requests", "RATE_LIMITED"));
            next();
        } catch (err) {
            next(err);
        }
    };
}

export const chatRateLimit = rateLimit({
    windowMs: 60_000,
    max: 20,
    key: (req) => `chat:user:${(req as unknown as { user?: { id: string } }).user?.id ?? req.ip}`,
    message: "Chat rate limited — try again shortly",
});

export const conversationCreateLimit = rateLimit({
    windowMs: 60_000,
    max: 10,
    key: (req) => `conv:user:${(req as unknown as { user?: { id: string } }).user?.id ?? req.ip}`,
});

// Additional presets per spec §6 — Redis-backed distributed
export const authRateLimit = rateLimit({ windowMs: 60_000, max: 5, key: (req) => `auth:ip:${req.ip}`, message: "Too many auth attempts" });
export const characterCreateLimit = rateLimit({ windowMs: 60_000, max: 5, key: (req) => `charCreate:user:${(req as any).user?.id ?? req.ip}` });
export const searchRateLimit = rateLimit({ windowMs: 60_000, max: 30, key: (req) => `search:user:${(req as any).user?.id ?? req.ip}` });
export const messageRateLimit = rateLimit({ windowMs: 60_000, max: 20, key: (req) => `message:user:${(req as any).user?.id ?? req.ip}` });
export const generationRateLimit = rateLimit({ windowMs: 60_000, max: 10, key: (req) => `generation:user:${(req as any).user?.id ?? req.ip}` });
export const streamRateLimit = rateLimit({ windowMs: 60_000, max: 20, key: (req) => `stream:user:${(req as any).user?.id ?? req.ip}` });
export const documentUploadLimit = rateLimit({ windowMs: 60_000, max: 10, key: (req) => `docUpload:user:${(req as any).user?.id ?? req.ip}` });
export const reportRateLimit = rateLimit({ windowMs: 60_000, max: 5, key: (req) => `report:user:${(req as any).user?.id ?? req.ip}` });
