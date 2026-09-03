import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/db.js";
import { validate } from "../../middleware/validation.middleware.js";
import { createAuthMiddleware } from "../auth/middleware/auth.middleware.js";
import { AuthRepository } from "../auth/repositories/auth.repository.js";
import { AuthService } from "../auth/services/auth.service.js";
import { moderationService } from "../../infrastructure/moderation/moderation.service.js";
import { auditService } from "../../infrastructure/audit/audit.service.js";
import { ApiError } from "../../utils/apiError.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { apiSuccess } from "../../utils/apiSuccess.js";

const authRepo = new AuthRepository(prisma);
const authService = new AuthService(authRepo);
const { requireAuth } = createAuthMiddleware(authService);

function requireModerator(req: any, _res: any, next: any) {
    const role = req.user?.role;
    if (!["MODERATOR", "ADMIN", "OWNER"].includes(role)) return next(new ApiError(403, "Moderator only", "FORBIDDEN"));
    next();
}

const router = Router();

// Create moderation case (any authenticated user can report any target, but also moderators can open directly)
const createCaseSchema = z.object({
    body: z.object({
        targetType: z.enum(["CHARACTER", "MESSAGE", "USER", "DOCUMENT"]),
        targetId: z.string().min(1),
        reason: z.enum(["SPAM", "HARASSMENT", "INAPPROPRIATE_CONTENT", "IMPERSONATION", "COPYRIGHT", "OTHER"]),
        description: z.string().max(2000).optional().nullable(),
        priority: z.number().int().min(0).max(10).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    }),
});

router.post("/cases", requireAuth, validate(createCaseSchema as any), asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const b = req.body as any;
    const c = await moderationService.createCase({ targetType: b.targetType, targetId: b.targetId, reason: b.reason, description: b.description ?? null, reporterId: userId, metadata: b.metadata, priority: b.priority ?? 0 });
    return apiSuccess(res, { statusCode: 201, message: "Moderation case created", data: { case: c } });
}));

router.get("/cases", requireAuth, requireModerator, asyncHandler(async (req, res) => {
    const { status, targetType, cursor, limit } = req.query as { status?: string; targetType?: string; cursor?: string; limit?: string };
    const result = await moderationService.listCases({ status, targetType, cursor: cursor ?? null, limit: limit ? parseInt(limit, 10) : 20 });
    return apiSuccess(res, { message: "Cases", data: result.data, meta: { nextCursor: result.nextCursor, hasMore: result.hasMore } as any });
}));

router.get("/cases/:id", requireAuth, requireModerator, asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const c = await moderationService.getCase(id);
    if (!c) throw new ApiError(404, "Case not found", "NOT_FOUND");
    return apiSuccess(res, { message: "Case", data: { case: c } });
}));

const decideSchema = z.object({
    body: z.object({
        decision: z.enum(["ALLOW", "BLOCK", "REVIEW", "SUSPEND", "RESTORE", "ARCHIVE", "DELETE", "WARN"]),
        reason: z.string().max(2000).optional().nullable(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    }),
});

router.post("/cases/:id/decide", requireAuth, requireModerator, validate(decideSchema as any), asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;
    const role = req.user!.role;
    const b = req.body as any;
    const action = await moderationService.decide({
        caseId: id,
        actorId: userId,
        actorRole: role,
        decision: b.decision,
        reason: b.reason ?? null,
        metadata: b.metadata,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
    });
    return apiSuccess(res, { message: "Decision applied", data: { action } });
}));

// Audit log (immutable, moderator/admin only)
router.get("/audit", requireAuth, requireModerator, asyncHandler(async (req, res) => {
    const { actorId, targetId, action, cursor, limit } = req.query as { actorId?: string; targetId?: string; action?: string; cursor?: string; limit?: string };
    const result = await auditService.list({ actorId, targetId, action, cursor: cursor ?? null, limit: limit ? parseInt(limit, 10) : 50 });
    return apiSuccess(res, { message: "Audit logs", data: result.data, meta: { nextCursor: result.nextCursor, hasMore: result.hasMore } as any });
}));

export default router;
