import { ChatPromptTemplate } from "@langchain/core/prompts";

export const TITLE_SYSTEM_PROMPT = `Generate a short, compelling conversation title.
- 3-7 words, Title Case
- Capture the core topic or mood
- No quotes, no punctuation at end
- Plain text only`.trim();

export const TITLE_USER_TEMPLATE = `Character: {charName}
First messages:
{snippet}

Generate the title.`.trim();

export function buildTitlePrompt(charName: string, snippet: string): string {
    return TITLE_USER_TEMPLATE.replace("{charName}", charName).replace("{snippet}", snippet.slice(0, 800));
}

export const titlePrompt = ChatPromptTemplate.fromMessages([
    ["system", TITLE_SYSTEM_PROMPT],
    ["user", TITLE_USER_TEMPLATE],
]);
