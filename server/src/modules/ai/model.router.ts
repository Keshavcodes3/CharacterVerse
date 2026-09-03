import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middleware/validation.middleware.js";
import { createAuthMiddleware } from "../auth/middleware/auth.middleware.js";
import { AuthRepository } from "../auth/repositories/auth.repository.js";
import { AuthService } from "../auth/services/auth.service.js";
import { prisma } from "../../infrastructure/database/db.js";
import { aiService } from "./ai.service.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { apiSuccess } from "../../utils/apiSuccess.js";

const authRepository = new AuthRepository(prisma);
const authService = new AuthService(authRepository);
const { requireAuth } = createAuthMiddleware(authService);

const router = Router();

const chatSchema = z.object({
    body: z.object({
        conversationId: z.string().uuid(),
        content: z.string().min(1).max(10000),
        idempotencyKey: z.string().min(1).max(100).optional(),
        provider: z.enum(["mistral", "gemini", "groq"]).optional().default("mistral"),
        model: z.string().optional(),
        stream: z.boolean().optional().default(false),
    }),
});

const chatStreamSchema = chatSchema;

router.post(
    "/chat",
    requireAuth,
    validate(chatSchema),
    asyncHandler(async (req, res) => {
        const userId = req.user!.id;
        const { conversationId, content, idempotencyKey, provider, model, stream } = req.body as z.infer<typeof chatSchema>["body"];

        if (stream) {
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            });
            try {
                for await (const evt of aiService.chatStream({ conversationId, userId, content, idempotencyKey, modelConfig: { provider: provider as never, model } })) {
                    if (evt.type === "token") res.write(`data: ${JSON.stringify({ t: evt.token })}\n\n`);
                    else if (evt.type === "done") res.write(`data: ${JSON.stringify({ done: true, content: evt.content })}\n\n`);
                    else if (evt.type === "error") res.write(`data: ${JSON.stringify({ error: evt.error })}\n\n`);
                    else res.write(`data: ${JSON.stringify(evt)}\n\n`);
                }
                res.write(`data: [DONE]\n\n`);
                res.end();
            } catch (e) {
                res.write(`data: ${JSON.stringify({ error: String((e as Error).message) })}\n\n`);
                res.end();
            }
            return;
        }

        const result = await aiService.chat({ conversationId, userId, content, idempotencyKey, modelConfig: { provider: provider as never, model } });
        return apiSuccess(res, { message: "Message sent", data: result });
    }),
);

export default router;
