import crypto from "node:crypto";
import { prisma } from "../../infrastructure/database/db.js";
import { agentService, type StreamEvent } from "../../infrastructure/ai/agentService.js";
import { ConversationRepository } from "../conversations/conversation.repository.js";
import { MessageRepository } from "../messages/message.repository.js";
import { MessageService } from "../messages/message.service.js";
import { GenerationService } from "../../infrastructure/ai/generation.service.js";
import { conversationLock } from "../../infrastructure/ai/conversationLock.service.js";
import { logger } from "../../config/pino.js";
import type { ModelConfig } from "../../infrastructure/ai/modelRegistry.js";

const convRepo = new ConversationRepository(prisma);
const msgRepo = new MessageRepository(prisma);
const msgService = new MessageService(convRepo, msgRepo);
const genService = new GenerationService();

function isRetryable(err: unknown): boolean {
    const m = String((err as Error).message ?? "").toLowerCase();
    return m.includes("429") || m.includes("timeout") || m.includes("econnreset") || m.includes("provider");
}

export class AiService {
    /** Spec §7 pipeline: Auth → Authorize → Validate → Idempotency → Persist USER → Lock → Load version/history/memory/RAG → Build context → Invoke → Persist ASSISTANT → Update conv → Unlock → Events */
    async chat(params: {
        conversationId: string;
        userId: string;
        content: string;
        idempotencyKey?: string;
        modelConfig?: ModelConfig;
        requestId?: string;
    }) {
        const requestId = params.requestId ?? crypto.randomUUID();
        const t0 = Date.now();

        // Idempotency + USER persist (no tx held during LLM per spec)
        const { message: userMsg, isDuplicate } = await msgService.createUserMessage({
            conversationId: params.conversationId,
            userId: params.userId,
            content: params.content,
            idempotencyKey: params.idempotencyKey,
        });

        if (isDuplicate) {
            const existingAssistant = await prisma.message.findFirst({ where: { conversationId: params.conversationId, generationId: userMsg.id } });
            if (existingAssistant) {
                logger.info({ requestId, conversationId: params.conversationId, userId: params.userId, idempotencyKey: params.idempotencyKey }, "Idempotent replay — returning cached assistant");
                return { userMessage: userMsg, assistantMessage: existingAssistant, fromCache: true as const };
            }
            // duplicate user but no assistant yet — check if generation running, else wait
        }

        const generationId = crypto.randomUUID();
        // Concurrency: serialize per conversation
        const locked = await conversationLock.acquire(params.conversationId, generationId);
        if (!locked) throw new Error("Conversation is busy — another generation in progress");

        const gen = await genService.create({
            conversationId: params.conversationId,
            userMessageId: userMsg.id,
            provider: params.modelConfig?.provider ?? "mistral",
            model: params.modelConfig?.model ?? null,
            requestId,
        });
        await genService.markRunning(gen.id);

        const genIdForObs = gen.id;
        let firstTokenAt: number | null = null;

        try {
            const conv = await convRepo.findById(params.conversationId);
            if (!conv) throw new Error("Conversation not found");
            // character version resolution per spec §17
            const characterVersionId = conv.characterVersionId;
            const recent = await msgRepo.recent(params.conversationId, 30);

            const agentState = {
                user: { id: params.userId, username: "User" },
                character: conv.character as never,
                characterVersion: conv.characterVersion as never,
                conversation: { id: conv.id, title: conv.title, summary: conv.summary },
                recentMessages: recent.map((m) => ({ role: m.role, messageType: (m as unknown as { messageType?: string }).messageType, content: m.content })),
                memories: [],
                retrievedDocuments: [],
                metadata: { requestId, generationId: genIdForObs },
            };

            const started = Date.now();
            const text = await agentService.invoke(agentState, params.modelConfig ?? { provider: "mistral" });
            const latencyMs = Date.now() - started;
            const inputTokens = Math.ceil(JSON.stringify(recent).length / 4);
            const outputTokens = Math.ceil(text.length / 4);

            // Persist ASSISTANT atomically after LLM succeeds — not before
            const assistant = await prisma.$transaction(async (tx) => {
                const last = await tx.message.findFirst({ where: { conversationId: params.conversationId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
                const seq = (last?.sequence ?? 0) + 1;
                const msg = await tx.message.create({
                    data: {
                        conversationId: params.conversationId,
                        role: "ASSISTANT" as never,
                        messageType: "TEXT" as never,
                        content: text,
                        sequence: seq,
                        characterVersionId: characterVersionId ?? null,
                        generationId: genIdForObs,
                        modelProvider: params.modelConfig?.provider ?? "mistral",
                        modelName: params.modelConfig?.model ?? null,
                        inputTokens,
                        outputTokens,
                    },
                });
                await tx.conversation.update({ where: { id: params.conversationId }, data: { lastMessageAt: new Date(), updatedAt: new Date(), version: { increment: 1 } } });
                await tx.generation.update({ where: { id: genIdForObs }, data: { status: "COMPLETED", completedAt: new Date(), latencyMs, inputTokens, outputTokens, messageId: msg.id } });
                await tx.outboxEvent.create({ data: { aggregateType: "Conversation", aggregateId: params.conversationId, eventType: "AssistantMessageCreated", payload: { conversationId: params.conversationId, messageId: msg.id, generationId: genIdForObs } as never, status: "PENDING" } });
                await tx.outboxEvent.create({ data: { aggregateType: "Conversation", aggregateId: params.conversationId, eventType: "GenerationCompleted", payload: { generationId: genIdForObs, conversationId: params.conversationId, requestId } as never, status: "PENDING" } });
                return msg;
            });

            logger.info({ requestId, generationId: genIdForObs, conversationId: params.conversationId, userId: params.userId, characterId: conv.characterId, characterVersionId, latencyMs, inputTokens, outputTokens, provider: params.modelConfig?.provider ?? "mistral" }, "Generation completed");

            // async side effects: memory extraction, title gen — non-blocking; do not hold tx
            void import("../../infrastructure/memory/memory.service.js").then(async ({ MemoryService: MS }) => {
                const ms = new MS(prisma);
                const transcript = recent.slice(-10).map((m) => `${m.role}: ${m.content}`).join("\n") + `\nUSER: ${params.content}\nASSISTANT: ${text}`;
                await ms.extractAndPersist({ characterId: conv.characterId, characterName: conv.character.name, userId: params.userId, conversationId: params.conversationId, recentTranscript: transcript });
            });

            return { userMessage: userMsg, assistantMessage: assistant, generationId: genIdForObs, latencyMs, inputTokens, outputTokens };
        } catch (err) {
            const errorCode = isRetryable(err) ? "RETRYABLE" : "NON_RETRYABLE";
            await genService.markFailed(genIdForObs, String((err as Error).message).slice(0, 2000), errorCode).catch(() => {});
            logger.error({ requestId, generationId: genIdForObs, conversationId: params.conversationId, err }, "Generation failed");
            throw err;
        } finally {
            await conversationLock.release(params.conversationId, generationId).catch(() => {});
            logger.info({ requestId, generationId: genIdForObs, totalMs: Date.now() - t0 }, "Chat pipeline finished");
        }
    }

    /** Streaming: yields MESSAGE_STARTED → TOKEN* → TOOL_STARTED/COMPLETED → MESSAGE_COMPLETED/FAILED */
    async *chatStream(params: {
        conversationId: string;
        userId: string;
        content: string;
        idempotencyKey?: string;
        modelConfig?: ModelConfig;
        requestId?: string;
    }): AsyncGenerator<StreamEvent & { event?: string }> {
        const requestId = params.requestId ?? crypto.randomUUID();
        const { message: userMsg } = await msgService.createUserMessage({
            conversationId: params.conversationId,
            userId: params.userId,
            content: params.content,
            idempotencyKey: params.idempotencyKey,
        });
        const generationId = crypto.randomUUID();
        const locked = await conversationLock.acquire(params.conversationId, generationId);
        if (!locked) throw new Error("Conversation busy");

        const gen = await genService.create({ conversationId: params.conversationId, userMessageId: userMsg.id, provider: params.modelConfig?.provider ?? "mistral", requestId });
        await genService.markRunning(gen.id);

        const conv = await convRepo.findById(params.conversationId);
        if (!conv) { await conversationLock.release(params.conversationId, generationId); throw new Error("Conversation not found"); }
        const recent = await msgRepo.recent(params.conversationId, 30);
        const characterVersionId = conv.characterVersionId;

        const agentState = {
            user: { id: params.userId, username: "User" },
            character: conv.character as never,
            characterVersion: conv.characterVersion as never,
            conversation: { id: conv.id, title: conv.title, summary: conv.summary },
            recentMessages: recent.map((m) => ({ role: m.role, content: m.content })),
            memories: [], retrievedDocuments: [], metadata: { requestId, generationId: gen.id },
        };

        const tFirst = Date.now();
        let firstToken = true;
        let full = "";
        let failed = false;

        // Spec §8 events: MESSAGE_STARTED
        yield { type: "status", message: "MESSAGE_STARTED", event: "MESSAGE_STARTED" } as unknown as StreamEvent;

        try {
            for await (const evt of agentService.stream(agentState, params.modelConfig ?? { provider: "mistral" })) {
                if (evt.type === "token") {
                    if (firstToken) {
                        const ttfb = Date.now() - tFirst;
                        logger.info({ requestId, generationId: gen.id, ttfb }, "Time to first token");
                        firstToken = false;
                    }
                    full += evt.token;
                    // map to spec TOKEN
                    yield { type: "token", token: evt.token, event: "TOKEN" } as unknown as StreamEvent;
                } else if (evt.type === "tool_start") yield { type: "tool_start", tool: evt.tool, input: evt.input, event: "TOOL_STARTED" } as unknown as StreamEvent;
                else if (evt.type === "tool_end") yield { type: "tool_end", tool: evt.tool, output: evt.output, event: "TOOL_COMPLETED" } as unknown as StreamEvent;
                else if (evt.type === "error") { failed = true; yield { type: "error", error: evt.error, event: "MESSAGE_FAILED" } as unknown as StreamEvent; }
                else yield evt as unknown as StreamEvent;
            }

            if (failed || !full) {
                await genService.markFailed(gen.id, "Stream failed or empty", "STREAM_FAILED");
                yield { type: "error", error: "Generation failed", event: "MESSAGE_FAILED" } as unknown as StreamEvent;
                return;
            }

            // Persist only on successful completion — partial ≠ completed per spec §9
            const last = await prisma.message.findFirst({ where: { conversationId: params.conversationId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
            const msg = await prisma.message.create({
                data: {
                    conversationId: params.conversationId,
                    role: "ASSISTANT" as never,
                    messageType: "TEXT" as never,
                    content: full,
                    sequence: (last?.sequence ?? 0) + 1,
                    characterVersionId: characterVersionId ?? null,
                    generationId: gen.id,
                    modelProvider: params.modelConfig?.provider ?? "mistral",
                    modelName: params.modelConfig?.model ?? null,
                    outputTokens: Math.ceil(full.length / 4),
                },
            });
            await prisma.conversation.update({ where: { id: params.conversationId }, data: { lastMessageAt: new Date() } });
            await genService.markCompleted(gen.id, { outputTokens: Math.ceil(full.length / 4), latencyMs: Date.now() - tFirst, messageId: msg.id });
            await prisma.outboxEvent.create({ data: { aggregateType: "Conversation", aggregateId: params.conversationId, eventType: "AssistantMessageCreated", payload: { conversationId: params.conversationId, messageId: msg.id } as never, status: "PENDING" } });

            yield { type: "done", content: full, event: "MESSAGE_COMPLETED" } as unknown as StreamEvent;
        } catch (err) {
            await genService.markFailed(gen.id, String((err as Error).message).slice(0, 2000), "STREAM_EXCEPTION").catch(() => {});
            yield { type: "error", error: String((err as Error).message), event: "MESSAGE_FAILED" } as unknown as StreamEvent;
            throw err;
        } finally {
            await conversationLock.release(params.conversationId, generationId).catch(() => {});
        }
    }
}

export const aiService = new AiService();
export const generateCharacters = async () => { throw new Error("Use CharacterService.create"); };
