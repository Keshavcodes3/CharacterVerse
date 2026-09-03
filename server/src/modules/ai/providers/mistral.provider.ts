import { ChatMistralAI } from "@langchain/mistralai";

export const mistralModel: ChatMistralAI = new ChatMistralAI({
    model: "mistral-large-latest",
    temperature: 0.7,
    maxRetries: 2,
});