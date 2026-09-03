import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { apiSuccess } from "../../utils/apiSuccess.js";
import type { MessageService } from "./message.service.js";
import type { ConversationRepository } from "../conversations/conversation.repository.js";
import type { MessageRepository } from "./message.repository.js";
import { aiService } from "../ai/ai.service.js";

export class MessageController {
    constructor(
        private readonly msgService: MessageService,
        private readonly convRepo: ConversationRepository,
        private readonly msgRepo: MessageRepository,
    ) {}

    list = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { conversationId } = req.params as { conversationId: string };
        const q = req.query as unknown as { page: number; limit: number; before?: string; after?: string };
        const result = await this.msgService.list(conversationId, userId, { page: q.page, limit: q.limit, before: q.before, after: q.after });
        return apiSuccess(res, { message: "Messages fetched", data: result.data, meta: result.meta });
    });

    listCursor = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { conversationId } = req.params as { conversationId: string };
        const q = req.query as unknown as { cursor?: string; limit?: string; direction?: "forward" | "backward" };
        const result = await this.msgRepo.listCursor(conversationId, { cursor: q.cursor ?? null, limit: q.limit ? parseInt(q.limit, 10) : 30, direction: q.direction });
        // authorize
        const conv = await this.convRepo.findByIdForUser(conversationId, userId);
        if (!conv) return apiSuccess(res, { statusCode: 404, message: "Conversation not found" } as never);
        return apiSuccess(res, { message: "Messages fetched", data: result.data, meta: { nextCursor: result.nextCursor, hasMore: result.hasMore } } as never);
    });

    /** Non-streaming: persist user msg -> generate -> persist assistant */
    send = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { conversationId } = req.params as { conversationId: string };
        const { content, role, metadata, attachments } = req.body as { content: string; role: string; metadata?: unknown; attachments?: unknown };
        const idempotencyKey = (req.headers["x-idempotency-key"] as string) || (req.body as { idempotencyKey?: string }).idempotencyKey;

        // For now only USER messages via this endpoint; assistant is generated
        if (role && role !== "USER") {
            // allow system injection only for admins — otherwise force USER
        }

        const result = await aiService.chat({
            conversationId,
            userId,
            content,
            idempotencyKey,
            modelConfig: { provider: "mistral" },
        });

        return apiSuccess(res, { message: "Message sent", data: result });
    });

    sendStream = asyncHandler(async (req: Request, res: Response) => {
        const userId = req.user!.id;
        const { conversationId } = req.params as { conversationId: string };
        const { content } = req.body as { content: string };
        const idempotencyKey = (req.headers["x-idempotency-key"] as string) || (req.body as { idempotencyKey?: string }).idempotencyKey;
        const requestId = (req.headers["x-request-id"] as string) || undefined;

        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });

        try {
            for await (const evt of aiService.chatStream({ conversationId, userId, content, idempotencyKey, modelConfig: { provider: "mistral" }, requestId })) {
                if (evt.type === "token") res.write(`data: ${JSON.stringify({ event: "TOKEN", token: evt.token })}\n\n`);
                else if (evt.type === "tool_start") res.write(`data: ${JSON.stringify({ event: "TOOL_STARTED", tool: (evt as unknown as { tool: string }).tool })}\n\n`);
                else if (evt.type === "tool_end") res.write(`data: ${JSON.stringify({ event: "TOOL_COMPLETED", tool: (evt as unknown as { tool: string }).tool })}\n\n`);
                else if (evt.type === "status") res.write(`data: ${JSON.stringify({ event: (evt as unknown as { event: string }).event ?? "MESSAGE_STARTED" })}\n\n`);
                else if (evt.type === "done") res.write(`data: ${JSON.stringify({ event: "MESSAGE_COMPLETED", content: evt.content })}\n\n`);
                else if (evt.type === "error") res.write(`data: ${JSON.stringify({ event: "MESSAGE_FAILED", error: evt.error })}\n\n`);
                else res.write(`data: ${JSON.stringify(evt)}\n\n`);
            }
            res.write(`data: [DONE]\n\n`);
            res.end();
        } catch (e) {
            res.write(`data: ${JSON.stringify({ event: "MESSAGE_FAILED", error: String((e as Error).message) })}\n\n`);
            res.write(`data: [DONE]\n\n`);
            res.end();
        }
    });
}
