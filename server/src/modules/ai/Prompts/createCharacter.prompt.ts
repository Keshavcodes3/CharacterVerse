import { ChatPromptTemplate } from "@langchain/core/prompts";

/**
 * Structured output expected from the LLM when generating a character.
 * Keep in sync with `character.schema.ts` / Prisma `Character` + `CharacterPersonality`.
 */
export interface GeneratedCharacter {
    name: string;
    description: string;
    greeting: string;
    avatarPrompt?: string;
    visibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
    category: string[];
    tags: string[];
    personality: {
        traits: string[];
        backstory: string;
        personality: string;
        lore?: string | null;
        knowledge?: string | null;
        scenario?: string | null;
        exampleDialogues: Array<{ user: string; character: string }>;
    };
    examples: Array<{ title?: string; content: string; isDialogue: boolean }>;
}

export const CREATE_CHARACTER_SYSTEM_PROMPT = `You are CharacterVerse — an expert character designer for immersive roleplay.

You create rich, original, roleplay-ready characters. Every character must be:
- Internally consistent and vivid
- Grounded with a clear personality, backstory, voice, and motivation
- Safe: never sexualize minors, never generate disallowed content. If the user request is disallowed, create a safe, adjacent alternative and explain.

OUTPUT RULES:
- Respond with VALID JSON only — no markdown, no code fences, no commentary.
- Follow the exact JSON shape provided in the user message.
- Keep "description" 2-4 sentences (hook, not lore dump).
- Keep "greeting" 80-220 words, in-character, second-person, sets the scene and invites the user. Do NOT prefix with the character name.
- "personality" should be 120-250 words, trait-driven, describes how they speak and act.
- "backstory" should be 150-300 words.
- "traits" 5-10 short adjectives/phrases.
- "exampleDialogues" 3-5 pairs that showcase voice. Keep each turn <40 words.
- "examples" 1-3 longer scenario snippets (optional but recommended for quality).
- "category" 1-3 values (e.g. ["anime","fantasy","comedy"]).
- "tags" 4-10 kebab-case tags.
- "avatarPrompt" a concise image-generation prompt for the character portrait (optional).
`.trim();

export const CREATE_CHARACTER_USER_TEMPLATE = `Create a character from this idea:

<idea>
{idea}
</idea>

Additional directives:
- Language: {language}
- Tone: {tone}
- NSFW allowed: {nsfwAllowed}
- Target length: {length}
{extraInstructions}

Return JSON with this exact shape:
{{
  "name": "string (1-100 chars)",
  "description": "string (short hook)",
  "greeting": "string (in-character opening message)",
  "avatarPrompt": "string | optional",
  "visibility": "PUBLIC | UNLISTED | PRIVATE",
  "category": ["string"],
  "tags": ["string"],
  "personality": {{
    "traits": ["string"],
    "backstory": "string",
    "personality": "string",
    "lore": "string | null",
    "knowledge": "string | null",
    "scenario": "string | null",
    "exampleDialogues": [{{ "user": "string", "character": "string" }}]
  }},
  "examples": [{{ "title": "string | optional", "content": "string", "isDialogue": true }}]
}}

JSON only.` .trim();

export type CreateCharacterPromptVariables = {
    idea: string;
    language?: string;
    tone?: string;
    nsfwAllowed?: boolean;
    length?: "short" | "medium" | "long";
    extraInstructions?: string;
};

export function buildCreateCharacterPrompt(vars: CreateCharacterPromptVariables): string {
    return CREATE_CHARACTER_USER_TEMPLATE
        .replace("{idea}", vars.idea)
        .replace("{language}", vars.language ?? "en")
        .replace("{tone}", vars.tone ?? "balanced")
        .replace("{nsfwAllowed}", String(vars.nsfwAllowed ?? false))
        .replace("{length}", vars.length ?? "medium")
        .replace("{extraInstructions}", vars.extraInstructions ? `- ${vars.extraInstructions}` : "");
}

export const createCharacterPrompt = ChatPromptTemplate.fromMessages([
    ["system", CREATE_CHARACTER_SYSTEM_PROMPT],
    ["user", CREATE_CHARACTER_USER_TEMPLATE],
]);

/** Quick validation hint for JSON output — use with Zod/json parser in ai.service */
export const CREATE_CHARACTER_JSON_SCHEMA_HINT = `Return JSON matching GeneratedCharacter interface` as const;
