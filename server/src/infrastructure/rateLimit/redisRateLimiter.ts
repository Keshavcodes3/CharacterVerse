import { logger } from "../../config/pino.js";
import { getCache } from "../cache/cache.js";

// We use the same Redis client as cache if available, else fallback to in-memory via cache abstraction
// For true distributed, we use cache.get/set with atomic increment via Lua (if Redis). Fallback allows single-instance.

interface RateLimitOptions {
    key: string;
    windowMs: number;
    max: number;
}

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

export async function isRateLimited(opts: RateLimitOptions): Promise<{ limited: boolean; remaining: number; resetAt: number }> {
    const cache = getCache();
    // Try Redis atomic increment via raw client if possible
    try {
        const maybeRedis = (cache as any).client ?? null;
        if (maybeRedis && typeof maybeRedis.incr === "function") {
            const redisKey = `ratelimit:${opts.key}`;
            const count = await maybeRedis.incr(redisKey);
            if (count === 1) {
                await maybeRedis.expire(redisKey, Math.ceil(opts.windowMs / 1000));
            }
            const ttl = await maybeRedis.ttl(redisKey);
            const resetAt = Date.now() + (ttl > 0 ? ttl * 1000 : opts.windowMs);
            return { limited: count > opts.max, remaining: Math.max(0, opts.max - count), resetAt };
        }
    } catch (err) {
        logger.warn({ err }, "Redis rate limit failed, fallback to memory");
    }

    // Fallback in-memory (also used when Redis unavailable)
    const now = Date.now();
    let b = memoryBuckets.get(opts.key);
    if (!b || now > b.resetAt) {
        b = { count: 0, resetAt: now + opts.windowMs };
        memoryBuckets.set(opts.key, b);
    }
    b.count += 1;
    return { limited: b.count > opts.max, remaining: Math.max(0, opts.max - b.count), resetAt: b.resetAt };
}

// Presets per spec §6
export const RateLimitPresets = {
    auth: { windowMs: 60_000, max: 5 },
    characterCreate: { windowMs: 60_000, max: 5 },
    characterSearch: { windowMs: 60_000, max: 30 },
    conversationCreate: { windowMs: 60_000, max: 10 },
    messageCreate: { windowMs: 60_000, max: 20 },
    llmGeneration: { windowMs: 60_000, max: 10 },
    stream: { windowMs: 60_000, max: 20 },
    documentUpload: { windowMs: 60_000, max: 10 },
    report: { windowMs: 60_000, max: 5 },
} as const;
