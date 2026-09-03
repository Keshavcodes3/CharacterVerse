import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

export const geminiModel = new ChatGoogleGenerativeAI({
    model: "gemini-3-pro",
    temperature: 0.7,
    maxRetries: 2,
});