import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { cohereModel } from "./cohere.provider.js";
import { geminiModel } from "./gemini.provider.js";
import { groqModel } from "./groq.provider.js";
import { mistralModel } from "./mistral.provider.js";

export type AIProvider = "mistral" | "gemini" | "cohere" | "groq";

const models: Record<AIProvider, BaseChatModel> = {
    mistral: mistralModel,
    gemini: geminiModel,
    cohere: cohereModel,
    groq: groqModel,
};

export function getModel(provider: AIProvider): BaseChatModel {
    const model = models[provider];
    if (!model) {
        throw new Error(`Unknown AI provider: ${provider}`);
    }
    return model;
}

// Keep alias for backward compatibility
export const returnModels = getModel;

export { models };
