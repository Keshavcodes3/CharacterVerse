import { Router } from "express";
import { prisma } from "../../infrastructure/database/db.js";
import { validate } from "../../middleware/validation.middleware.js";
import { createAuthMiddleware } from "../auth/middleware/auth.middleware.js";
import { AuthRepository } from "../auth/repositories/auth.repository.js";
import { AuthService } from "../auth/services/auth.service.js";
import { KnowledgeController } from "./knowledge.controller.js";
import {
    createKnowledgeBaseSchema,
    createDocumentSchema,
    listDocumentsSchema,
    getDocumentSchema,
    deleteDocumentSchema,
    searchKnowledgeSchema,
} from "./knowledge.schema.js";

const authRepo = new AuthRepository(prisma);
const authService = new AuthService(authRepo);
const { requireAuth } = createAuthMiddleware(authService);

const controller = new KnowledgeController();
const router = Router();

import { documentUploadLimit, searchRateLimit } from "../../middleware/rate-limit.middleware.js";

// KnowledgeBase
router.post("/characters/:characterId/knowledge-bases", requireAuth, validate(createKnowledgeBaseSchema), controller.createKB);
router.get("/characters/:characterId/knowledge-bases", requireAuth, controller.listKB);

// Documents
router.post("/characters/:characterId/documents", requireAuth, documentUploadLimit, validate(createDocumentSchema), controller.createDocument);
router.get("/characters/:characterId/documents", requireAuth, validate(listDocumentsSchema), controller.listDocuments);
router.get("/characters/:characterId/documents/:documentId", requireAuth, validate(getDocumentSchema), controller.getDocument);
router.delete("/characters/:characterId/documents/:documentId", requireAuth, validate(deleteDocumentSchema), controller.deleteDocument);

// Search (RAG)
router.get("/characters/:characterId/knowledge/search", requireAuth, searchRateLimit, validate(searchKnowledgeSchema), controller.search);

export default router;
