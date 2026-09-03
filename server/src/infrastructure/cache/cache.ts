import { logger } from "../../config/pino.js";
import { env } from "../../config/env.js";

export interface Cache {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
    del(key: string): Promise<void>;
    delByPrefix(prefix: string): Promise<void>;
}

class InMemoryCache implements Cache {
    private store = new Map<string, { value: unknown; expiresAt: number }>();
    private timers = new Map<string, NodeJS.Timeout>();

    async get<T>(key: string): Promise<T | null> {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return entry.value as T;
    }

    async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
        const expiresAt = Date.now() + ttlSeconds * 1000;
        this.store.set(key, { value, expiresAt });
        // auto cleanup
        if (this.timers.has(key)) clearTimeout(this.timers.get(key)!);
        const t = setTimeout(() => this.store.delete(key), ttlSeconds * 1000);
        if (t.unref) t.unref();
        this.timers.set(key, t);
    }

    async del(key: string): Promise<void> {
        this.store.delete(key);
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key)!);
            this.timers.delete(key);
        }
    }

    async delByPrefix(prefix: string): Promise<void> {
        for (const k of [...this.store.keys()]) {
            if (k.startsWith(prefix)) await this.del(k);
        }
    }
}

class RedisCache implements Cache {
    private client: any;
    private fallback: InMemoryCache;
    constructor(client: any, fallback: InMemoryCache) {
        this.client = client;
        this.fallback = fallback;
    }
    async get<T>(key: string): Promise<T | null> {
        try {
            const v = await this.client.get(key);
            if (v === null || v === undefined) return null;
            return JSON.parse(v) as T;
        } catch (e) {
            logger.warn({ err: e }, "Redis get failed, fallback");
            return this.fallback.get<T>(key);
        }
    }
    async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
        try {
            await this.client.set(key, JSON.stringify(value), { EX: ttlSeconds });
        } catch (e) {
            logger.warn({ err: e }, "Redis set failed, fallback");
            await this.fallback.set(key, value, ttlSeconds);
        }
    }
    async del(key: string): Promise<void> {
        try {
            await this.client.del(key);
        } catch (e) {
            logger.warn({ err: e }, "Redis del failed");
        }
        await this.fallback.del(key);
    }
    async delByPrefix(prefix: string): Promise<void> {
        try {
            // SCAN
            let cursor = 0;
            do {
                const res = await this.client.scan(cursor, { MATCH: prefix + "*", COUNT: 100 });
                cursor = res.cursor;
                if (res.keys?.length) await this.client.del(res.keys);
            } while (cursor !== 0);
        } catch (e) {
            logger.warn({ err: e }, "Redis delByPrefix failed");
        }
        await this.fallback.delByPrefix(prefix);
    }
}

// Singleton — tries Redis, falls back to memory (production-grade: never fails discovery if Redis down)
let cacheInstance: Cache | null = null;

export function getCache(): Cache {
    if (cacheInstance) return cacheInstance;
    const fallback = new InMemoryCache();
    const redisUrl = env.REDIS_URL;
    if (redisUrl) {
        try {
            // lazy import to avoid hard dep if not installed
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { createClient } = require("redis") as any;
            const client = createClient({ url: redisUrl });
            client.on("error", (err: unknown) => logger.warn({ err }, "Redis client error"));
            // connect async, but don't block
            client.connect().catch((err: unknown) => logger.warn({ err }, "Redis connect failed"));
            cacheInstance = new RedisCache(client, fallback);
            logger.info("Redis cache enabled");
            return cacheInstance;
        } catch (e) {
            logger.warn({ err: e }, "Redis not available, using InMemoryCache");
        }
    }
    cacheInstance = fallback;
    return cacheInstance;
}

export const cache = getCache();

// Invalidation helpers per spec §9 — explicit rules, never cache auth-sensitive globally
export const CacheKeys = {
    popular: (cursor?: string | null) => `discovery:popular:${cursor ?? "first"}`,
    trending: (cursor?: string | null) => `discovery:trending:${cursor ?? "first"}`,
    newChars: (cursor?: string | null) => `discovery:new:${cursor ?? "first"}`,
    recommended: (userId: string, cursor?: string | null) => `discovery:recommended:${userId}:${cursor ?? "first"}`,
    search: (q: string, cursor?: string | null) => `search:${q}:${cursor ?? "first"}`,
    character: (idOrSlug: string) => `character:${idOrSlug}`,
} as const;

export const CacheTTL = {
    DISCOVERY: 60, // 1m
    SEARCH: 30,
    CHARACTER: 120,
} as const;
