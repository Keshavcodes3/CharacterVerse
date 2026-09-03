import { ChatPromptTemplate } from "@langchain/core/prompts";

export type MemoryType = "FACT" | "PREFERENCE" | "EVENT" | "MEMORY";

export interface ExtractedMemory {
    type: MemoryType;
    content: string;
    importance: number; // 1-5
}

export const MEMORY_EXTRACTION_SYSTEM_PROMPT = `You are CharacterVerse memory extraction.

Extract durable memories/facts about the USER from the conversation that should persist across sessions.

RULES:
- Extract only USER facts/preferences/events, not character lore.
- Each memory: one atomic fact, 8-28 words, self-contained.
- Type: FACT (stable attribute), PREFERENCE (likes/dislikes), EVENT (something that happened), MEMORY (emotional moment).
- Importance 1-5: 1=trivial, 5=core identity.
- Max 5 memories per call. If none, return empty array.
- No duplicates, no speculation.
- Output VALID JSON only: { "memories": [{ "type": "FACT|PREFERENCE|EVENT|MEMORY", "content": "string", "importance": 1-5 }] }`.trim();

export const MEMORY_EXTRACTION_USER_TEMPLATE = `Conversation with character "{charName}":

<conversation>
{conversation}
</conversation>

Existing memories (avoid duplicates):
{existingMemories}

Extract new memories. JSON only.`.trim();

export interface MemoryExtractionVariables {
    charName: string;
    conversation: string;
    existingMemories?: string[];
}

export function buildMemoryExtractionPrompt(vars: MemoryExtractionVariables): string {
    return MEMORY_EXTRACTION_USER_TEMPLATE
        .replace("{charName}", vars.charName)
        .replace("{conversation}", vars.conversation)
        .replace("{existingMemories}", vars.existingMemories?.length ? vars.existingMemories.map((m) => `- ${m}`).join("\n") : "None");
}

export const memoryExtractionPrompt = ChatPromptTemplate.fromMessages([
    ["system", MEMORY_EXTRACTION_SYSTEM_PROMPT],
    ["user", MEMORY_EXTRACTION_USER_TEMPLATE],
]);
