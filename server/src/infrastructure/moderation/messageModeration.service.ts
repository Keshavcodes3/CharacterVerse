import { logger } from "../../config/pino.js";
import { env } from "../../config/env.js";

export type ModerationVerdict = "ALLOW" | "BLOCK" | "REVIEW";

export interface ModerationCheckResult {
    verdict: ModerationVerdict;
    reason?: string;
    confidence?: number;
    categories?: string[];
}

const BLOCKED_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
    { regex: /(kill\s+yourself|kys\b)/i, reason: "self_harm" },
    { regex: /(explicit\s+sexual\s+content\s+with\s+minor|child\s+porn)/i, reason: "csam" },
    { regex: /\b(credit\s*card\s*number|ssn\s*[:=])/i, reason: "pii" },
];

const REVIEW_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
    { regex: /(hate\s+speech|slur)/i, reason: "potential_hate" },
    { regex: /(spam|buy\s+now|click\s+here)/i, reason: "spam" },
];

export class MessageModerationService {
    /**
     * Synchronous local checks + optional async external provider.
     * Per spec: do not unnecessarily make every moderation synchronous if it harms availability — so
     * caller can run with { async: true } to defer REVIEW cases.
     */
    async check(content: string, opts?: { async?: boolean; userId?: string; conversationId?: string }): Promise<ModerationCheckResult> {
        const trimmed = content.trim();
        if (!trimmed) return { verdict: "BLOCK", reason: "empty" };

        // 1. Hard block patterns (no external call needed)
        for (const p of BLOCKED_PATTERNS) {
            if (p.regex.test(trimmed)) {
                logger.warn({ reason: p.reason }, "message blocked by pattern");
                return { verdict: "BLOCK", reason: p.reason, confidence: 1 };
            }
        }

        // 2. Review patterns — if async mode, return REVIEW without blocking availability
        for (const p of REVIEW_PATTERNS) {
            if (p.regex.test(trimmed)) {
                if (opts?.async) {
                    logger.info({ reason: p.reason }, "message flagged for review (async)");
                    return { verdict: "REVIEW", reason: p.reason, confidence: 0.6 };
                }
                // sync mode: still flag REVIEW, caller may choose to block or queue
                return { verdict: "REVIEW", reason: p.reason, confidence: 0.6 };
            }
        }

        // 3. External provider stub (e.g., OpenAI moderation / Perspective) — degradable
        // If provider down, default to ALLOW to preserve availability
        try {
            // Example: call external moderation if env set
            if (env.MODERATION_PROVIDER_URL) {
                const res = await fetch(env.MODERATION_PROVIDER_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content: trimmed }),
                });
                if (res.ok) {
                    const data = (await res.json()) as { verdict: ModerationVerdict; reason?: string };
                    if (data.verdict === "BLOCK" || data.verdict === "REVIEW") return data;
                }
            }
        } catch (err) {
            logger.warn({ err }, "external moderation failed — allowing");
        }

        return { verdict: "ALLOW" };
    }

    /** Helper for hooks: shouldBlock/shouldReview */
    isBlocked(result: ModerationCheckResult): boolean {
        return result.verdict === "BLOCK";
    }
}

export const messageModerationService = new MessageModerationService();
