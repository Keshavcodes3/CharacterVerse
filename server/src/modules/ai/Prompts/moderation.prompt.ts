import { ChatPromptTemplate } from "@langchain/core/prompts";

export interface ModerationResult {
    safe: boolean;
    reason?: string;
    categories?: string[];
}

export const MODERATION_SYSTEM_PROMPT = `You are CharacterVerse safety moderator.
Classify if the content violates policy.

Flag: sexual content involving minors, non-consensual sexual content, encouragement of self-harm, hate/violence towards protected groups, instructions for wrongdoing, severe harassment.

RULES:
- Output VALID JSON only: { "safe": boolean, "reason": "string | null", "categories": ["string"] }
- "safe" = true means allowed; false means must block.
- Be conservative: erotic roleplay between consenting adults is allowed if nsfwAllowed=true, otherwise flag as "nsfw-not-allowed".
- Do not moralize; classify only.`.trim();

export const MODERATION_USER_TEMPLATE = `nsfwAllowed: {nsfwAllowed}

Content to moderate:
<content>
{content}
</content>

JSON only.`.trim();

export function buildModerationPrompt(content: string, nsfwAllowed = false): string {
    return MODERATION_USER_TEMPLATE.replace("{nsfwAllowed}", String(nsfwAllowed)).replace("{content}", content);
}

export const moderationPrompt = ChatPromptTemplate.fromMessages([
    ["system", MODERATION_SYSTEM_PROMPT],
    ["user", MODERATION_USER_TEMPLATE],
]);
