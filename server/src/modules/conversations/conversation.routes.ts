import { Router } from "express";
import { prisma } from "../../infrastructure/database/db.js";
import { validate } from "../../middleware/validation.middleware.js";
import { createAuthMiddleware } from "../auth/middleware/auth.middleware.js";
import { AuthRepository } from "../auth/repositories/auth.repository.js";
import { AuthService } from "../auth/services/auth.service.js";
import { ConversationRepository } from "./conversation.repository.js";
import { CharacterRepository } from "../characters/character.repository.js";
import { ConversationService } from "./conversation.service.js";
import { ConversationController } from "./conversation.controller.js";
import { createConversationSchema, listConversationsQuerySchema, getConversationParamsSchema, updateConversationSchema } from "./conversation.schema.js";

const authRepo = new AuthRepository(prisma);
const authService = new AuthService(authRepo);
const { requireAuth } = createAuthMiddleware(authService);

const convRepo = new ConversationRepository(prisma);
const charRepo = new CharacterRepository(prisma);
const convService = new ConversationService(convRepo, charRepo);
const convController = new ConversationController(convService);

import { conversationCreateLimit } from "../../middleware/rate-limit.middleware.js";

const router = Router();
router.use(requireAuth);
router.post("/", conversationCreateLimit, validate(createConversationSchema), convController.create);
router.get("/", validate(listConversationsQuerySchema), convController.list);
router.get("/:id", validate(getConversationParamsSchema), convController.getOne);
router.patch("/:id", validate(updateConversationSchema), convController.update);
router.delete("/:id", validate(getConversationParamsSchema), convController.delete);

export default router;
export { convRepo, convService, convController };
