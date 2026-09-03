import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getModel, type AIProvider } from "../../modules/ai/providers/index.js";
import { logger } from "../../config/pino.js";

export type ModelConfig = {
    provider: AIProvider;
    model?: string;
    temperature?: number;
    maxTokens?: number;
};

export class AIModelRegistry {
    getChatModel(config: ModelConfig): BaseChatModel {
        const base = getModel(config.provider);
        // LangChain models expose bind-like kwargs; we clone via invocation kwargs
        // For now return base; per-request overrides via .withConfig or invoke options
        if (config.temperature !== undefined || config.maxTokens !== undefined || config.model) {
            logger.info({ provider: config.provider, model: config.model }, "Model override requested — using base model (override via invoke options)");
            // If underlying model supports withConfig, apply
            const maybe = base as unknown as { bind?: (kwargs: Record<string, unknown>) => BaseChatModel };
            if (maybe.bind) {
                try {
                    return maybe.bind({
                        ...(config.model ? { model: config.model } : {}),
                        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
                        ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
                    });
                } catch { /* fallback to base */ }
            }
        }
        return base;
    }

    getReranker() {
        // Cohere is infra for reranking; not a chat model
        // Lazy import to avoid circular deps
        return { provider: "cohere" as const };
    }
}

export const modelRegistry = new AIModelRegistry();
