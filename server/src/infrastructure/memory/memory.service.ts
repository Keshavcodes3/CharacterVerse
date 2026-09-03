import type { PrismaClient } from "../../generated/prisma/client.js";
import { getModel } from "../../modules/ai/providers/index.js";
import { memoryExtractionPrompt } from "../../modules/ai/Prompts/memory.prompt.js";
import { logger } from "../../config/pino.js";
import { prisma } from "../database/db.js";

export class MemoryService {
    constructor(private readonly db: PrismaClient) {}

    async retrieve(characterId: string, userId: string, conversationId?: string, limit = 8) {
        try {
            const where: Record<string, unknown> = { characterId };
            // scoped per spec: do not leak between users — filter by userId if present
            if (userId) (where as Record<string, unknown>).userId = userId;
            // optionally filter by conversation
            const memories = await this.db.memory.findMany({
                where: where as never,
                orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
                take: limit,
            });
            return memories;
        } catch (err) {
            logger.warn({ err, characterId }, "Memory retrieval failed, continuing without memory");
            return [];
        }
    }

    /** Extraction pipeline: Conversation -> Candidate -> Validate -> Persist */
    async extractAndPersist(params: { characterId: string; characterName: string; userId: string; conversationId: string; recentTranscript: string }) {
        try {
            const existing = await this.db.memory.findMany({ where: { characterId: params.characterId, userId: params.userId }, select: { content: true }, take: 20 });
            const model = getModel("mistral");
            const messages = await memoryExtractionPrompt.formatMessages({
                charName: params.characterName,
                conversation: params.recentTranscript.slice(0, 4000),
                existingMemories: existing.map((m) => m.content).join("\n") || "None",
            });
            const res = await model.invoke(messages);
            const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
            const parsed = extractJson(text) as { memories?: Array<{ type: string; content: string; importance: number }> };
            const candidates = (parsed.memories ?? []).slice(0, 5).filter((m) => m.content && m.content.length >= 8 && m.content.length <= 500);
            if (candidates.length === 0) return [];

            const created: unknown[] = [];
            for (const c of candidates) {
                // dedup: skip if very similar to existing
                if (existing.some((e) => e.content.toLowerCase() === c.content.toLowerCase())) continue;
                const mem = await prisma.memory.create({
                    data: {
                        characterId: params.characterId,
                        userId: params.userId,
                        conversationId: params.conversationId,
                        type: (["FACT", "PREFERENCE", "EVENT", "MEMORY"].includes(c.type) ? c.type : "MEMORY") as never,
                        content: c.content,
                        importance: Math.min(5, Math.max(1, c.importance ?? 1)),
                    },
                });
                created.push(mem);
                await prisma.outboxEvent.create({ data: { aggregateType: "Memory", aggregateId: mem.id, eventType: "MemoryCreated", payload: { memoryId: mem.id, characterId: params.characterId, userId: params.userId } as never, status: "PENDING" } });
            }
            return created;
        } catch (err) {
            logger.warn({ err, characterId: params.characterId }, "Memory extraction failed");
            return [];
        }
    }
}

function extractJson(text: string): unknown {
    const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    try { return JSON.parse(trimmed); } catch {
        const s = trimmed.indexOf("{"); const e = trimmed.lastIndexOf("}");
        if (s !== -1 && e !== -1) return JSON.parse(trimmed.slice(s, e + 1));
        return {};
    }
}
