import { ChatPromptTemplate } from "@langchain/core/prompts";

export const GENERATE_GREETING_SYSTEM_PROMPT = `You write immersive, in-character greeting messages for roleplay characters.
Greetings set the scene, voice, and hook — they are NOT a bio.
- 80-220 words, second-person, present tense
- Show, don't tell. One vivid moment, not lore dump.
- End with a clear invitation to respond.

Output plain text only — just the greeting, no quotes or JSON.`.trim();

export const GENERATE_GREETING_USER_TEMPLATE = `Character:
Name: {name}
Description: {description}
Personality: {personality}
Scenario: {scenario}
Traits: {traits}

Style hint: {style}
NSFW allowed: {nsfwAllowed}

Write one greeting for this character.`.trim();

export interface GenerateGreetingVariables {
    name: string;
    description: string;
    personality?: string;
    scenario?: string | null;
    traits?: string;
    style?: string;
    nsfwAllowed?: boolean;
}

export function buildGreetingPrompt(vars: GenerateGreetingVariables): string {
    return GENERATE_GREETING_USER_TEMPLATE
        .replace("{name}", vars.name)
        .replace("{description}", vars.description)
        .replace("{personality}", vars.personality ?? "Not specified")
        .replace("{scenario}", vars.scenario ?? "Not specified")
        .replace("{traits}", vars.traits ?? "Not specified")
        .replace("{style}", vars.style ?? "immersive, inviting")
        .replace("{nsfwAllowed}", String(vars.nsfwAllowed ?? false));
}

export const greetingPrompt = ChatPromptTemplate.fromMessages([
    ["system", GENERATE_GREETING_SYSTEM_PROMPT],
    ["user", GENERATE_GREETING_USER_TEMPLATE],
]);
