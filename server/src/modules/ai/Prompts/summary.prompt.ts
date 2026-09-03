import { ChatPromptTemplate } from "@langchain/core/prompts";

export const SUMMARY_SYSTEM_PROMPT = `You summarize roleplay conversations for CharacterVerse.

Goal: produce a concise, third-person summary that preserves continuity.

RULES:
- 120-280 words.
- Include: who, relationship, key events, emotional beats, unresolved threads.
- Do NOT invent facts.
- Plain text only — no JSON, no bullet list unless needed (max 5 bullets).
- If conversation is short (<6 messages) return "No summary needed — conversation too short."`.trim();

export const SUMMARY_USER_TEMPLATE = `Summarize this conversation between User and {charName}.

<character>
{charName}: {charDescription}
</character>

<conversation>
{conversation}
</conversation>

Existing summary (if any):
{existingSummary}

Produce the updated summary.`.trim();

export interface SummaryVariables {
    charName: string;
    charDescription: string;
    conversation: string; // formatted transcript
    existingSummary?: string | null;
}

export function buildSummaryPrompt(vars: SummaryVariables): string {
    return SUMMARY_USER_TEMPLATE
        .replaceAll("{charName}", vars.charName)
        .replace("{charDescription}", vars.charDescription)
        .replace("{conversation}", vars.conversation)
        .replace("{existingSummary}", vars.existingSummary ?? "None");
}

export const summaryPrompt = ChatPromptTemplate.fromMessages([
    ["system", SUMMARY_SYSTEM_PROMPT],
    ["user", SUMMARY_USER_TEMPLATE],
]);

/** Simple transcript formatter */
export function formatTranscript(messages: Array<{ role: string; content: string }>, maxMessages = 40): string {
    const slice = messages.slice(-maxMessages);
    return slice.map((m) => `${m.role}: ${m.content}`).join("\n");
}
