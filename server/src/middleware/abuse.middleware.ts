import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError.js";

const seenRequests = new Map<string, number>();

export function duplicateRequestGuard(req: Request, _res: Response, next: NextFunction) {
    const key = `${req.method}:${req.originalUrl}:${req.headers["x-idempotency-key"] ?? ""}:${(req as any).user?.id ?? req.ip}`;
    const now = Date.now();
    const last = seenRequests.get(key);
    if (last && now - last < 2000 && req.headers["x-idempotency-key"]) {
        return next(new ApiError(409, "Duplicate request in progress", "DUPLICATE_REQUEST"));
    }
    seenRequests.set(key, now);
    // cleanup after 10s
    setTimeout(() => seenRequests.delete(key), 10000);
    next();
}

export function largePayloadGuard(req: Request, _res: Response, next: NextFunction) {
    const len = Number(req.headers["content-length"] ?? 0);
    if (len > 1_000_000) {
        return next(new ApiError(413, "Payload too large", "PAYLOAD_TOO_LARGE"));
    }
    next();
}

// Expensive tool call guard — limit tool calls per generation
export function toolCallGuard(maxCalls = 5) {
    return (req: Request, _res: Response, next: NextFunction) => {
        const count = Number(req.headers["x-tool-calls"] ?? 0);
        if (count > maxCalls) return next(new ApiError(429, "Too many tool calls", "TOOL_RATE_LIMITED"));
        next();
    };
}
