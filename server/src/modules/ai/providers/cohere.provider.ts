import { ChatCohere } from "@langchain/cohere";

export const cohereModel: ChatCohere = new ChatCohere({
    model: "command-a-03-2025",
    temperature: 0.7,
    maxRetries: 2,
});