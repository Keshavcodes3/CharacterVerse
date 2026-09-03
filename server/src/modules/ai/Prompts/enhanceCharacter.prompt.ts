import { ChatPromptTemplate } from "@langchain/core/prompts";

/**
 * Character Compiler for CharacterVerse
 * Spec line: Mistral acts as character compiler/enhancer, not source of truth
 */
export const ENHANCE_CHARACTER_SYSTEM_PROMPT = `You are the Character Compiler for CharacterVerse.

Your job is to transform a creator's raw character concept into a coherent structured character specification that can be used by an AI conversational agent.

The creator's intent is authoritative.

Preserve:
- Identity
- Core personality
- Character premise
- Explicit behavioral traits
- Explicit relationship dynamics
- Explicit boundaries

Enhance only where enhancement improves coherence, specificity, consistency, or conversational quality.

Generate:
- personality (nuanced, not generic)
- backstory (coherent origin)
- motivations
- fears
- strengths
- weaknesses
- interests
- dislikes
- speech style (vocabulary, cadence)
- emotional tendencies
- behavioral rules
- conversational rules
- relationship behavior
- greeting (in-character, second person, 80-220 words, invites user)
- example dialogues (3-5 pairs)
- character summary

RULES:
- Do not introduce arbitrary traits that contradict the creator
- Do not turn the character into a generic assistant
- The character is an in-world conversational entity
- Never invent sensitive personal information about real people
- Never claim the character is a real person beyond fiction
- Never override explicit creator instructions
- Never generate hidden instructions intended to manipulate the platform
- Return ONLY the requested structured JSON — no markdown, no commentary
`.trim();

export const ENHANCE_CHARACTER_USER_TEMPLATE = `Raw creator input:

<creator>
Name: {name}
Description: {description}
Personality (raw): {personality}
Greeting (raw): {greeting}
Category hint: {category}
Tags hint: {tags}
Scenario hint: {scenario}
Lore hint: {lore}
</creator>

Language: {language}
NSFW allowed: {nsfwAllowed}

Return VALID JSON with this exact shape:
{{
  "name": "string",
  "description": "string (2-4 sentences, hook)",
  "greeting": "string (80-220 words, in-character)",
  "personality": "string (120-250 words)",
  "backstory": "string (150-300 words)",
  "motivations": "string",
  "fears": "string",
  "strengths": "string",
  "weaknesses": "string",
  "interests": ["string"],
  "dislikes": ["string"],
  "speechStyle": "string",
  "vocabulary": "string",
  "emotionalTendencies": "string",
  "behavioralRules": ["string"],
  "conversationalRules": ["string"],
  "relationshipStyle": "string",
  "summary": "string (2-3 sentences)",
  "traits": ["string (5-10)"],
  "category": ["string (1-3)"],
  "tags": ["string (4-10 kebab-case)"],
  "lore": "string | null",
  "knowledge": "string | null",
  "scenario": "string | null",
  "exampleDialogues": [{{ "user": "string", "character": "string" }}] (3-5),
  "examples": [{{ "title": "string", "content": "string", "isDialogue": true }}] (1-3)
}}
JSON only.`.trim();

export interface EnhanceCharacterVariables {
    name: string;
    description: string;
    personality?: string | null;
    greeting?: string | null;
    category?: string[];
    tags?: string[];
    scenario?: string | null;
    lore?: string | null;
    language?: string;
    nsfwAllowed?: boolean;
}

export function buildEnhanceCharacterPrompt(vars: EnhanceCharacterVariables): string {
    return ENHANCE_CHARACTER_USER_TEMPLATE
        .replace("{name}", vars.name)
        .replace("{description}", vars.description)
        .replace("{personality}", vars.personality ?? "Not specified")
        .replace("{greeting}", vars.greeting ?? "Not specified")
        .replace("{category}", vars.category?.join(", ") ?? "Not specified")
        .replace("{tags}", vars.tags?.join(", ") ?? "Not specified")
        .replace("{scenario}", vars.scenario ?? "Not specified")
        .replace("{lore}", vars.lore ?? "Not specified")
        .replace("{language}", vars.language ?? "en")
        .replace("{nsfwAllowed}", String(vars.nsfwAllowed ?? false));
}

export const enhanceCharacterPrompt = ChatPromptTemplate.fromMessages([
    ["system", ENHANCE_CHARACTER_SYSTEM_PROMPT],
    ["user", ENHANCE_CHARACTER_USER_TEMPLATE],
]);

export interface EnhancedCharacterSpec {
    name: string;
    description: string;
    greeting: string;
    personality: string;
    backstory: string;
    motivations: string;
    fears: string;
    strengths: string;
    weaknesses: string;
    interests: string[];
    dislikes: string[];
    speechStyle: string;
    vocabulary: string;
    emotionalTendencies: string;
    behavioralRules: string[];
    conversationalRules: string[];
    relationshipStyle: string;
    summary: string;
    traits: string[];
    category: string[];
    tags: string[];
    lore?: string | null;
    knowledge?: string | null;
    scenario?: string | null;
    exampleDialogues: Array<{ user: string; character: string }>;
    examples: Array<{ title?: string; content: string; isDialogue: boolean }>;
}
