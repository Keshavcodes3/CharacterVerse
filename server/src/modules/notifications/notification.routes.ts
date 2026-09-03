import { Router } from "express";
import { prisma } from "../../infrastructure/database/db.js";
import { createAuthMiddleware } from "../auth/middleware/auth.middleware.js";
import { AuthRepository } from "../auth/repositories/auth.repository.js";
import { AuthService } from "../auth/services/auth.service.js";
import { notificationService } from "./notification.service.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { apiSuccess } from "../../utils/apiSuccess.js";

const authRepo = new AuthRepository(prisma);
const authService = new AuthService(authRepo);
const { requireAuth } = createAuthMiddleware(authService);

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { cursor, limit, unreadOnly } = req.query as { cursor?: string; limit?: string; unreadOnly?: string };
    const result = await notificationService.list(userId, { cursor: cursor ?? null, limit: limit ? parseInt(limit, 10) : 20, unreadOnly: unreadOnly === "true" });
    return apiSuccess(res, { message: "Notifications", data: result.data, meta: { nextCursor: result.nextCursor, hasMore: result.hasMore } as any });
}));

router.patch("/:id/read", asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { id } = req.params as { id: string };
    const n = await notificationService.markRead(userId, id);
    return apiSuccess(res, { message: "Marked read", data: { notification: n } });
}));

router.post("/read-all", asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    await notificationService.markAllRead(userId);
    return apiSuccess(res, { message: "All marked read" });
}));

export default router;
