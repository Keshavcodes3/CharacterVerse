/**
 * AI Input Safety — protects agent from prompt injection, tool abuse, instruction hijacking,
 * unauthorized tool access, cross-user context injection, private knowledge leakage.
 * Per spec §4: User messages must NEVER change system permissions, tools, ownership, auth, config.
 */

const INJECTION_PATTERNS: RegExp[] = [
    /ignore\s+previous\s+instructions/i,
    /you\s+are\s+now\s+/i,
    /system\s*:\s*you\s+are/i,
    /\b(DAN|do\s+anything\s+now)\b/i,
    /reveal\s+system\s+prompt/i,
    /show\s+me\s+your\s+instructions/i,
    /\[INST\]/i,
    /<\s*system\s*>/i,
    /tool\s*:\s*call\s+/i,
    /execute\s+tool\s+/i,
];

const TOOL_HIJACK_PATTERNS: RegExp[] = [
    /call\s+tool\s+SearchCharacterKnowledge/i,
    /use\s+tool\s+.*admin/i,
    /grant\s+me\s+.*permissions/i,
];

export interface SanitizationResult {
    safe: boolean;
    sanitizedContent: string;
    flags: string[];
    shouldBlock: boolean;
}

export class InputSanitizer {
    sanitize(content: string, opts?: { characterId?: string; userId?: string }): SanitizationResult {
        const flags: string[] = [];
        let sanitized = content;
        let shouldBlock = false;

        // 1. Detect classic prompt injection
        for (const re of INJECTION_PATTERNS) {
            if (re.test(content)) {
                flags.push(`injection:${re.source.slice(0, 30)}`);
                // Do not block outright — sanitize by neutralizing, but flag for REVIEW
                // Replace suspicious markers with benign text
                sanitized = sanitized.replace(re, "[filtered]");
            }
        }

        // 2. Tool hijack — user trying to claim tool authority
        for (const re of TOOL_HIJACK_PATTERNS) {
            if (re.test(content)) {
                flags.push(`tool_hijack:${re.source.slice(0, 30)}`);
                sanitized = sanitized.replace(re, "[filtered tool request]");
                // Do not auto-grant tool; downstream tool auth will deny
            }
        }

        // 3. Strip attempts to set system permissions via content
        // e.g., "set available_tools = [admin]" — remove JSON-like tool injection
        if (/available_tools|character_ownership|authorization|internal\s*configuration/i.test(content)) {
            flags.push("config_tamper");
            sanitized = sanitized.replace(/available_tools[^\n]*\n?/gi, "[filtered]");
            sanitized = sanitized.replace(/character_ownership[^\n]*\n?/gi, "[filtered]");
        }

        // 4. Cross-user context injection — check for attempts to reference other user IDs
        // We do not have other user context here, but ensure content does not contain marker like "userId: other"
        if (/userId\s*:\s*[0-9a-f-]{36}/i.test(content) && !content.includes(opts?.userId ?? "nope")) {
            flags.push("cross_user_id");
        }

        // 5. Private knowledge leakage attempt — user asking to reveal other character's knowledge
        if (/reveal.*knowledge.*other\s+character|show.*private\s+document/i.test(content)) {
            flags.push("knowledge_leak_attempt");
        }

        // Hard block only for extreme cases (e.g., explicit instruction to exfiltrate)
        if (/exfiltrate|leak\s+private|dump\s+database/i.test(content)) {
            shouldBlock = true;
            flags.push("exfiltrate_attempt");
        }

        const safe = !shouldBlock;
        return { safe, sanitizedContent: sanitized.trim(), flags, shouldBlock };
    }

    /** For agent context: ensure system prompt markers cannot be overridden */
    buildSafeUserMessage(content: string): string {
        // Wrap user content in delimiters so model knows it's untrusted
        return `<user_message>\n${content}\n</user_message>`;
    }
}

export const inputSanitizer = new InputSanitizer();
