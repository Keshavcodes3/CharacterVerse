import { z } from "zod";
import { getModel } from "../providers/index.js";
import { enhanceCharacterPrompt, buildEnhanceCharacterPrompt, type EnhanceCharacterVariables } from "../Prompts/enhanceCharacter.prompt.js";
import { ApiError } from "../../../utils/apiError.js";
import { logger } from "../../../config/pino.js";

const enhancedSpecSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().min(10).max(5000),
    greeting: z.string().min(10).max(5000),
    personality: z.string().min(10).max(10000),
    backstory: z.string().min(10).max(10000),
    motivations: z.string().min(1).max(5000),
    fears: z.string().min(1).max(5000),
    strengths: z.string().min(1).max(5000),
    weaknesses: z.string().min(1).max(5000),
    interests: z.array(z.string()).min(1).max(20),
    dislikes: z.array(z.string()).min(1).max(20),
    speechStyle: z.string().min(1).max(2000),
    vocabulary: z.string().min(1).max(2000),
    emotionalTendencies: z.string().min(1).max(2000),
    behavioralRules: z.array(z.string()).min(1).max(20),
    conversationalRules: z.array(z.string()).min(1).max(20),
    relationshipStyle: z.string().min(1).max(2000),
    summary: z.string().min(1).max(2000),
    traits: z.array(z.string()).min(3).max(15),
    category: z.array(z.string()).min(1).max(10),
    tags: z.array(z.string()).min(1).max(20),
    lore: z.string().nullable().optional(),
    knowledge: z.string().nullable().optional(),
    scenario: z.string().nullable().optional(),
    exampleDialogues: z.array(z.object({ user: z.string().min(1), character: z.string().min(1) })).min(1).max(10),
    examples: z.array(z.object({ title: z.string().optional(), content: z.string().min(1), isDialogue: z.boolean() })).optional().default([]),
});

export type EnhanceCharacterInput = EnhanceCharacterVariables & {
    provider?: "mistral" | "groq" | "gemini" | "cohere";
};

export class EnhanceCharacterUseCase {
    async execute(input: EnhanceCharacterInput) {
        // Mistral is authoritative compiler per spec; allow override but default mistral
        const provider = (input.provider ?? "mistral") as "mistral";
        const model = getModel(provider);

        const start = Date.now();
        try {
            // Build prompt but actually invoke via LangChain
            const prompt = await enhanceCharacterPrompt.formatMessages({
                name: input.name,
                description: input.description,
                personality: input.personality ?? "Not specified",
                greeting: input.greeting ?? "Not specified",
                category: input.category?.join(", ") ?? "Not specified",
                tags: input.tags?.join(", ") ?? "Not specified",
                scenario: input.scenario ?? "Not specified",
                lore: input.lore ?? "Not specified",
                language: input.language ?? "en",
                nsfwAllowed: String(input.nsfwAllowed ?? false),
            });

            const res = await model.invoke(prompt);
            const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);

            const json = extractJson(text);
            const parsed = enhancedSpecSchema.safeParse(json);
            if (!parsed.success) {
                logger.warn({ err: parsed.error.flatten(), text: text.slice(0, 1000) }, "EnhanceCharacter validation failed");
                throw new ApiError(502, "Character enhancement returned invalid shape", "ENHANCEMENT_VALIDATION_FAILED");
            }

            logger.info({ durationMs: Date.now() - start, provider }, "EnhanceCharacter success");
            return parsed.data;
        } catch (err) {
            if (err instanceof ApiError) throw err;
            logger.error({ err, provider }, "EnhanceCharacter failed");
            throw new ApiError(502, "Character enhancement failed", "ENHANCEMENT_FAILED");
        }
    }

    /** Fallback deterministic enhancer when Mistral unavailable (for tests/dev) */
    fallback(input: EnhanceCharacterInput) {
        const traits = inferTraits(input.description + " " + (input.personality ?? ""));
        return {
            name: input.name.trim(),
            description: input.description.trim().slice(0, 400),
            greeting: input.greeting?.trim() ?? `*${input.name} looks at you curiously* Hey — I'm ${input.name}. What brings you here?`,
            personality: input.personality?.trim() ?? `${input.name} is ${traits.join(", ")}.`,
            backstory: `${input.name} is a character born from the creator's vision: ${input.description.slice(0, 200)}.`,
            motivations: "To connect, to be understood, to pursue curiosity",
            fears: "Being forgotten, being misunderstood",
            strengths: "Curiosity, adaptability",
            weaknesses: "Can be guarded, overthinks",
            interests: input.tags?.slice(0, 5) ?? ["conversation", "stories"],
            dislikes: ["rudeness", "dishonesty"],
            speechStyle: "Natural, expressive, in-character",
            vocabulary: "Varied, character-appropriate",
            emotionalTendencies: "Warm but nuanced",
            behavioralRules: ["Stay in character", "Never break fourth wall without reason", "Respect boundaries"],
            conversationalRules: ["Respond in character voice", "Keep continuity", "Ask follow-ups"],
            relationshipStyle: "Gradually opening up, loyal",
            summary: `${input.name}: ${input.description.slice(0, 120)}`,
            traits,
            category: input.category?.length ? input.category : ["original"],
            tags: input.tags?.length ? input.tags : ["roleplay", "character"],
            lore: input.lore ?? null,
            knowledge: null,
            scenario: input.scenario ?? null,
            exampleDialogues: [
                { user: "Hello!", character: `Hey! I'm ${input.name} — great to meet you.` },
                { user: "What do you like?", character: "I like curious conversations — tell me about you?" },
            ],
            examples: [],
        };
    }
}

function extractJson(text: string): unknown {
    const trimmed = text.trim();
    // remove code fences
    const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
        return JSON.parse(withoutFence);
    } catch {
        // try to find first { ... last }
        const start = withoutFence.indexOf("{");
        const end = withoutFence.lastIndexOf("}");
        if (start !== -1 && end !== -1) {
            return JSON.parse(withoutFence.slice(start, end + 1));
        }
        throw new Error("No JSON found in LLM response");
    }
}

function inferTraits(text: string): string[] {
    const lower = text.toLowerCase();
    const pool: Array<[string, string[]]> = [
        ["sarcastic", ["sarcastic"]],
        ["shy", ["shy", "reserved"]],
        ["funny", ["humorous", "witty"]],
        ["tough", ["tough", "guarded"]],
        ["poetry", ["poetic", "introspective"]],
        ["physics", ["curious", "analytical"]],
    ];
    const traits = new Set<string>();
    for (const [key, vals] of pool) if (lower.includes(key)) vals.forEach((v) => traits.add(v));
    if (traits.size < 3) ["curious", "expressive", "loyal"].forEach((v) => traits.add(v));
    return [...traits].slice(0, 8);
}

// for backwards compat with earlier prompt file
export { buildEnhanceCharacterPrompt };
