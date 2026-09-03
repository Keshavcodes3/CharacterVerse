import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
    NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),

    PORT: z.coerce.number().default(5000),

    DATABASE_URL: z.string().min(1),

    CLIENT_URL: z.string().url().optional(),

    LOG_LEVEL: z
        .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
        .default("info"),

    // Redis/Queue
    REDIS_URL: z.string().url().optional(),

    // AI provider API keys — optional in validation so the server can boot
    // without all providers configured; individual providers throw at runtime
    // if their key is missing when instantiated.
    GOOGLE_API_KEY: z.string().min(1).optional(),
    GEMINI_API_KEY: z.string().min(1).optional(),
    GROQ_API_KEY: z.string().min(1).optional(),
    MISTRAL_API_KEY: z.string().min(1).optional(),
    COHERE_API_KEY: z.string().min(1).optional(),

    // Optional moderation provider
    MODERATION_PROVIDER_URL: z.string().url().optional(),

    // Session
    SESSION_SECRET: z.string().min(32).optional(),
});

export const env = envSchema.parse(process.env);

/**
 * Resolved Gemini API key — supports both GOOGLE_API_KEY (LangChain convention)
 * and GEMINI_API_KEY (Google AI Studio convention). GOOGLE_API_KEY takes precedence.
 */
export const getGeminiApiKey = (): string | undefined =>
    env.GOOGLE_API_KEY ?? env.GEMINI_API_KEY;