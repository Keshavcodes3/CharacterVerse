import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { logger } from "../../config/pino.js";
import { modelRegistry, type ModelConfig } from "./modelRegistry.js";
import { ContextBuilder, type AgentState } from "./contextBuilder.js";
import { MemoryService } from "../memory/memory.service.js";
import { ToolRegistry } from "./tools/toolRegistry.js";
import { prisma } from "../database/db.js";
// RAG via production RetrievalService (embedding abstraction + vector store + Cohere rerank)

export type StreamEvent =
    | { type: "status"; message: string; event?: string }
    | { type: "token"; token: string; event?: string }
    | { type: "tool_start"; tool: string; input: unknown; event?: string }
    | { type: "tool_end"; tool: string; output: string; event?: string }
    | { type: "done"; content: string; usage?: { inputTokens?: number; outputTokens?: number }; event?: string }
    | { type: "error"; error: string; event?: string };

const RETRYABLE = new Set(["429", "timeout", "ETIMEDOUT", "ECONNRESET", "ENOTFOUND"]);
function isRetryable(err: unknown): boolean {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    return [...RETRYABLE].some((k) => msg.includes(k.toLowerCase())) || msg.includes("provider") || msg.includes("temporarily");
}

export class AgentService {
    private contextBuilder = new ContextBuilder();
    private memory = new MemoryService(prisma);
    private tools = new ToolRegistry(prisma);

    async invoke(state: AgentState, modelConfig: ModelConfig = { provider: "mistral" }): Promise<string> {
        const tRag0 = Date.now();
        const tMem0 = Date.now();
        const start = Date.now();
        let lastErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const built = await this.prepare(state);
                const ragLatency = Date.now() - tRag0;
                const memLatency = Date.now() - tMem0;
                logger.info({ characterId: state.character.id, ragLatency, memLatency, attempt }, "Context built");
                const model = modelRegistry.getChatModel(modelConfig);
                const messages = this.toMessages(built, state.recentMessages);
                const toolSet = this.tools.getToolsForCharacter(state.character.id, (state.metadata?.allowedTools as string[]) ?? []);
                const lcTools = this.tools.toLangChainTools(toolSet);
                const modelWithTools = lcTools.length ? (model as unknown as { bindTools?: (t: unknown[]) => BaseChatModel }).bindTools?.(lcTools) ?? model : model;

                const llmStart = Date.now();
                const res = await modelWithTools.invoke(messages);
                const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
                const llmLatency = Date.now() - llmStart;
                logger.info({ durationMs: Date.now() - start, llmLatency, provider: modelConfig.provider, model: modelConfig.model, characterId: state.character.id, characterVersionId: (state.characterVersion as unknown as { id?: string })?.id, inputTokens: built.history.length * 50, outputTokens: Math.ceil(text.length / 4) }, "Agent invoke completed");
                return text;
            } catch (err) {
                lastErr = err;
                const msg = String((err as Error).message ?? "");
                if (msg.includes("context") || msg.includes("overflow") || msg.includes("invalid") || msg.includes("tool")) {
                    logger.warn({ err, characterId: state.character.id }, "Non-retryable agent error");
                    break;
                }
                if (!isRetryable(err) || attempt === 2) break;
                const backoff = 200 * Math.pow(2, attempt) + Math.random() * 100;
                logger.warn({ err, attempt, backoff }, "Retryable agent error, backing off");
                await new Promise((r) => setTimeout(r, backoff));
            }
        }
        logger.error({ err: lastErr, characterId: state.character.id }, "Agent invoke failed");
        throw lastErr;
    }

    async *stream(state: AgentState, modelConfig: ModelConfig = { provider: "mistral" }): AsyncGenerator<StreamEvent> {
        const generationId = (state.metadata?.generationId as string) ?? crypto.randomUUID();
        const start = Date.now();
        yield { type: "status", message: "MESSAGE_STARTED", event: "MESSAGE_STARTED" };
        let lastErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const built = await this.prepare(state);
                const model = modelRegistry.getChatModel(modelConfig);
                const messages = this.toMessages(built, state.recentMessages);
                const toolSet = this.tools.getToolsForCharacter(state.character.id, (state.metadata?.allowedTools as string[]) ?? []);
                const lcTools = this.tools.toLangChainTools(toolSet);
                const modelWithTools = lcTools.length ? (model as unknown as { bindTools?: (t: unknown[]) => BaseChatModel }).bindTools?.(lcTools) ?? model : model;

                let full = "";
                let toolLatencyTotal = 0;
                const stream = await modelWithTools.stream(messages);
                for await (const chunk of stream) {
                    const token = typeof chunk.content === "string" ? chunk.content : "";
                    if (token) { full += token; yield { type: "token", token, event: "TOKEN" }; }
                    const toolCalls = (chunk as unknown as { tool_calls?: Array<{ name: string; args: unknown }> }).tool_calls;
                    if (toolCalls?.length) {
                        for (const tc of toolCalls) {
                            yield { type: "tool_start", tool: tc.name, input: tc.args, event: "TOOL_STARTED" };
                            const t0 = Date.now();
                            try {
                                const out = await this.tools.authorizeAndExecute({
                                    characterId: state.character.id,
                                    toolName: tc.name,
                                    input: tc.args,
                                    actorId: state.user.id,
                                    conversationId: state.conversation.id,
                                    allowedTools: (state.metadata?.allowedTools as string[]) ?? [],
                                });
                                toolLatencyTotal += Date.now() - t0;
                                yield { type: "tool_end", tool: tc.name, output: out.slice(0, 2000), event: "TOOL_COMPLETED" };
                            } catch (err) {
                                const msg = (err as Error).message;
                                logger.warn({ err, tool: tc.name }, "Tool authorization/execution failed");
                                yield { type: "tool_end", tool: tc.name, output: `Tool error: ${msg}`, event: "TOOL_COMPLETED" };
                            }
                        }
                    }
                }
                yield { type: "done", content: full, usage: {}, event: "MESSAGE_COMPLETED" };
                logger.info({ durationMs: Date.now() - start, provider: modelConfig.provider, generationId, outputTokens: Math.ceil(full.length / 4), toolLatencyTotal }, "Agent stream completed");
                return;
            } catch (err) {
                lastErr = err;
                const msg = String((err as Error).message ?? "");
                if (msg.includes("context") || msg.includes("overflow") || msg.includes("invalid")) break;
                if (!isRetryable(err) || attempt === 2) break;
                const backoff = 300 * Math.pow(2, attempt) + Math.random() * 100;
                yield { type: "status", message: `Retrying (${attempt + 1})...`, event: "MESSAGE_STARTED" };
                await new Promise((r) => setTimeout(r, backoff));
            }
        }
        yield { type: "error", error: String((lastErr as Error)?.message ?? lastErr), event: "MESSAGE_FAILED" };
        throw lastErr;
    }

    private async prepare(state: AgentState) {
        const t0 = Date.now();
        // Lazy import to avoid circular deps (knowledgeService -> prisma -> agentService)
        const { retrievalService } = await import("../../modules/knowledge/knowledge.service.js");
        const query = state.recentMessages.length ? state.recentMessages[state.recentMessages.length - 1]?.content ?? "" : "";
        const [ragDocs, memories] = await Promise.all([
            query ? retrievalService.retrieveRelevantKnowledge({ characterId: state.character.id, query, topK: 20, topN: 5 }).catch(() => []) : Promise.resolve([]),
            this.memory.retrieve(state.character.id, state.user.id, state.conversation.id, 8),
        ]);
        const latency = Date.now() - t0;
        logger.info({ conversationId: state.conversation.id, characterId: state.character.id, ragCount: (ragDocs as unknown[]).length, memoryCount: memories.length, latency }, "RAG/Memory retrieved");
        const enriched: AgentState = {
            ...state,
            retrievedDocuments: (ragDocs as Array<{ content: string; score: number }>).map((d) => ({ content: d.content, score: d.score })),
            memories: memories.map((m) => ({ content: m.content })),
        };
        return this.contextBuilder.build(enriched);
    }

    private toMessages(built: ReturnType<ContextBuilder["build"]>, recent: AgentState["recentMessages"]) {
        const msgs: Array<SystemMessage | HumanMessage | AIMessage> = [new SystemMessage(built.systemPrompt)];
        for (const m of recent.slice(-30)) {
            if (m.role === "USER") msgs.push(new HumanMessage(m.content));
            else if (m.role === "SYSTEM") msgs.push(new SystemMessage(m.content));
            else msgs.push(new AIMessage(m.content));
        }
        return msgs;
    }
}

export const agentService = new AgentService();
