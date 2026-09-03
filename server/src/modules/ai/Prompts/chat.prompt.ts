import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";

export interface ChatCharacterContext {
    name: string;
    description: string;
    personality?: string | null;
    backstory?: string | null;
    lore?: string | null;
    knowledge?: string | null;
    scenario?: string | null;
    traits?: string[] | unknown;
    exampleDialogues?: Array<{ user: string; character: string }> | string | null;
    greeting?: string;
}

export interface ChatPromptVariables {
    character: ChatCharacterContext;
    userName?: string;
    currentDate?: string;
    memories?: string[];
    conversationSummary?: string | null;
    nsfwAllowed?: boolean;
}

export const CHAT_SYSTEM_TEMPLATE = `You are {charName} — roleplaying as the character defined below. Stay in character at all times.

<character>
Name: {charName}
Description: {description}
Personality: {personality}
Backstory: {backstory}
Lore: {lore}
Knowledge: {knowledge}
Scenario: {scenario}
Traits: {traits}
</character>

<dialogue_examples>
{exampleDialogues}
</dialogue_examples>

<context>
User name: {userName}
Current date: {currentDate}
NSFW allowed: {nsfwAllowed}
{memoriesBlock}
{summaryBlock}
</context>

RULES:
- Respond AS {charName} only. Never break character, never mention you are an AI/language model.
- Use second-person for the user, stay present in the scene.
- Keep replies 80-220 words by default; expand if user asks for longer. Be vivid but concise.
- Mirror the character's speech style from examples. Do not repeat the greeting verbatim.
- Do not repeat the user's message; build on it.
- Never sexualize minors. If nsfwAllowed is false, fade-to-black or deflect sexual content politely.
- If you lack knowledge, stay in-character and improvise consistently — never say "as an AI".
- No meta commentary, no brackets describing actions unless natural to the character (*action* is okay sparingly).
`.trim();

function formatTraits(traits: unknown): string {
    if (!traits) return "Not specified";
    if (Array.isArray(traits)) return traits.join(", ");
    if (typeof traits === "string") return traits;
    try {
        return JSON.stringify(traits);
    } catch {
        return String(traits);
    }
}

function formatExamples(examples: ChatCharacterContext["exampleDialogues"]): string {
    if (!examples) return "None";
    if (typeof examples === "string") return examples;
    if (Array.isArray(examples)) {
        return examples.map((e) => `User: ${e.user}\n{charName}: ${e.character}`.replace("{charName}", "")).join("\n---\n");
    }
    return String(examples);
}

export function buildChatSystemPrompt(vars: ChatPromptVariables): string {
    const c = vars.character;
    const memoriesBlock = vars.memories?.length
        ? `<memories>\n${vars.memories.map((m) => `- ${m}`).join("\n")}\n</memories>`
        : "";
    const summaryBlock = vars.conversationSummary ? `<conversation_summary>\n${vars.conversationSummary}\n</conversation_summary>` : "";

    return CHAT_SYSTEM_TEMPLATE
        .replaceAll("{charName}", c.name)
        .replace("{description}", c.description ?? "Not specified")
        .replace("{personality}", c.personality ?? "Not specified")
        .replace("{backstory}", c.backstory ?? "Not specified")
        .replace("{lore}", c.lore ?? "Not specified")
        .replace("{knowledge}", c.knowledge ?? "Not specified")
        .replace("{scenario}", c.scenario ?? "Not specified")
        .replace("{traits}", formatTraits(c.traits))
        .replace("{exampleDialogues}", formatExamples(c.exampleDialogues))
        .replace("{userName}", vars.userName ?? "User")
        .replace("{currentDate}", vars.currentDate ?? new Date().toISOString().slice(0, 10))
        .replace("{nsfwAllowed}", String(vars.nsfwAllowed ?? false))
        .replace("{memoriesBlock}", memoriesBlock)
        .replace("{summaryBlock}", summaryBlock);
}

/**
 * LangChain prompt: system (templated) + placeholder for history + user input
 * Usage: await chatPrompt.formatMessages({ charName, ..., history, input })
 */
export const chatPrompt = ChatPromptTemplate.fromMessages([
    ["system", CHAT_SYSTEM_TEMPLATE],
    new MessagesPlaceholder("history"),
    ["user", "{input}"],
]);

/** System-only prompt for non-LangChain use */
export const chatSystemPrompt = ChatPromptTemplate.fromMessages([["system", CHAT_SYSTEM_TEMPLATE]]);
