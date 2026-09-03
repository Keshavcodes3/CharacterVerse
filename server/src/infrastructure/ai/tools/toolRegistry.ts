import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { PrismaClient } from "../../../generated/prisma/client.js";

/**
 * Internal tool abstraction — application layer depends on this interface,
 * not LangChain classes directly. Provider implementation wraps LangChain tool().
 */
export interface InternalTool {
    name: string;
    description: string;
    schema: z.ZodTypeAny;
    invoke: (input: unknown) => Promise<string>;
}

import { ApiError } from "../../../utils/apiError.js";

export class ToolRegistry {
    constructor(private readonly db: PrismaClient) {}

    /**
     * Tool authorize → validate → execute → audit (spec §5)
     * Never assume model decided = allowed. Every invocation re-validates.
     */
    async authorizeAndExecute(params: {
        characterId: string;
        toolName: string;
        input: unknown;
        actorId: string;
        actorRole?: string;
        conversationId?: string;
        allowedTools: string[];
    }): Promise<string> {
        const { characterId, toolName, input, actorId, allowedTools } = params;

        // 1. authorize: is tool allowed for this character?
        if (!allowedTools.includes(toolName)) {
            throw new ApiError(403, `Tool ${toolName} not allowed for this character`, "TOOL_NOT_ALLOWED");
        }

        // 2. validate arguments via schema
        const tool = this.createAllTools(characterId).find((t) => t.name === toolName);
        if (!tool) throw new ApiError(404, `Tool ${toolName} not found`, "TOOL_NOT_FOUND");
        const parsed = tool.schema.safeParse(input);
        if (!parsed.success) throw new ApiError(400, `Invalid tool arguments for ${toolName}`, "INVALID_TOOL_ARGS");

        // 3. extra authz per tool (e.g., private knowledge isolation)
        if (toolName === "SearchCharacterKnowledge") {
            // Ensure character ownership check already done at conversation level, but re-check
            const conv = params.conversationId ? await this.db.conversation.findUnique({ where: { id: params.conversationId }, select: { userId: true, characterId: true } }) : null;
            if (conv && conv.characterId !== characterId) throw new ApiError(403, "Knowledge access denied — cross-character leak blocked", "ISOLATION_VIOLATION");
            if (conv && conv.userId !== actorId) {
                // user can only access their own conversation's character knowledge — prevent IDOR
                throw new ApiError(403, "Not your conversation", "FORBIDDEN");
            }
        }

        // 4. execute + audit
        const output = await tool.invoke(parsed.data);
        // audit (fire-and-forget, immutable)
        try {
            const { auditService } = await import("../../audit/audit.service.js");
            await auditService.log({
                actorId,
                action: "MESSAGE_CREATED" as any, // generic tool audit
                targetType: "CHARACTER" as any,
                targetId: characterId,
                metadata: { tool: toolName, input: parsed.data },
            });
        } catch {}
        return output;
    }

    getToolsForCharacter(characterId: string, allowed: string[]): InternalTool[] {
        const all = this.createAllTools(characterId);
        if (!allowed.length) return [];
        return all.filter((t) => allowed.includes(t.name));
    }

    private createAllTools(characterId: string): InternalTool[] {
        return [
            {
                name: "GetCharacterInformation",
                description: "Get character profile, personality and backstory",
                schema: z.object({}),
                invoke: async () => {
                    const c = await this.db.character.findUnique({ where: { id: characterId }, include: { personality: true, profile: true } });
                    if (!c) return "Character not found";
                    return JSON.stringify({ name: c.name, description: c.description, personality: c.personality?.personality, backstory: c.personality?.backstory, profile: c.profile });
                },
            },
            {
                name: "GetConversationMemory",
                description: "Retrieve long-term memories for the current user/character",
                schema: z.object({ limit: z.number().optional().default(5) }),
                invoke: async (input) => {
                    const { limit } = (input ?? { limit: 5 }) as { limit: number };
                    const memories = await this.db.memory.findMany({ where: { characterId }, take: Math.min(limit, 10), orderBy: { importance: "desc" } });
                    return JSON.stringify(memories.map((m) => ({ content: m.content, type: m.type, importance: m.importance })));
                },
            },
            {
                name: "SearchCharacterKnowledge",
                description: "Search character's private knowledge base (RAG). Isolated per character.",
                schema: z.object({ query: z.string().min(1) }),
                invoke: async (input) => {
                    const { query } = input as { query: string };
                    // RAG isolation: only this character's documents
                    const docs = await this.db.knowledgeDocument.findMany({ where: { characterId }, take: 5 });
                    // naive keyword filter fallback
                    const filtered = docs.filter((d) => d.content.toLowerCase().includes(query.toLowerCase())).slice(0, 3);
                    const results = filtered.length ? filtered : docs.slice(0, 2);
                    return JSON.stringify(results.map((d) => ({ title: d.title, snippet: d.content.slice(0, 500) })));
                },
            },
            {
                name: "SearchWeb",
                description: "Search web for general knowledge (stub, no external call in offline mode)",
                schema: z.object({ query: z.string().min(1) }),
                invoke: async (input) => {
                    const { query } = input as { query: string };
                    return `Web search disabled in this environment. Query was: ${query}`;
                },
            },
        ];
    }

    /** Convert to LangChain tools for agent runtime */
    toLangChainTools(tools: InternalTool[]) {
        return tools.map((t) =>
            tool(async (input) => t.invoke(input), {
                name: t.name,
                description: t.description,
                schema: t.schema,
            }),
        );
    }
}
