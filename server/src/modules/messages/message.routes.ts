import { Router } from "express";
import { prisma } from "../../infrastructure/database/db.js";
import { validate } from "../../middleware/validation.middleware.js";
import { createAuthMiddleware } from "../auth/middleware/auth.middleware.js";
import { AuthRepository } from "../auth/repositories/auth.repository.js";
import { AuthService } from "../auth/services/auth.service.js";
import { ConversationRepository } from "../conversations/conversation.repository.js";
import { MessageRepository } from "./message.repository.js";
import { MessageService } from "./message.service.js";
import { MessageController } from "./message.controller.js";
import { createMessageSchema, listMessagesQuerySchema } from "./message.schema.js";

const authRepo = new AuthRepository(prisma);
const authService = new AuthService(authRepo);
const { requireAuth } = createAuthMiddleware(authService);

const convRepo = new ConversationRepository(prisma);
const msgRepo = new MessageRepository(prisma);
const msgService = new MessageService(convRepo, msgRepo);
const msgController = new MessageController(msgService, convRepo, msgRepo);

import { chatRateLimit } from "../../middleware/rate-limit.middleware.js";

const router = Router();
router.use(requireAuth);
router.post("/:conversationId/messages", chatRateLimit, validate(createMessageSchema), msgController.send);
router.get("/:conversationId/messages", validate(listMessagesQuerySchema), msgController.list);
router.post("/:conversationId/messages/stream", chatRateLimit, validate(createMessageSchema), msgController.sendStream);
router.get("/:conversationId/messages/cursor", validate(listMessagesQuerySchema), msgController.listCursor);

export default router;
