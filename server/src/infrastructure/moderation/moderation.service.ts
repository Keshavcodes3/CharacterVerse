import { prisma } from "../database/db.js";
import { ApiError } from "../../utils/apiError.js";
import { auditService } from "../audit/audit.service.js";
import { logger } from "../../config/pino.js";

export type TargetType = "CHARACTER" | "MESSAGE" | "USER" | "DOCUMENT";

export class ModerationService {
    async createCase(params: {
        targetType: TargetType;
        targetId: string;
        reason: string;
        description?: string | null;
        reporterId?: string | null;
        metadata?: unknown;
        priority?: number;
    }) {
        const c = await prisma.moderationCase.create({
            data: {
                targetType: params.targetType as any,
                targetId: params.targetId,
                reason: params.reason as any,
                description: params.description ?? null,
                reporterId: params.reporterId ?? null,
                priority: params.priority ?? 0,
                metadata: params.metadata as any,
            },
        });
        await auditService.log({
            actorId: params.reporterId ?? null,
            action: "REPORT_CREATED",
            targetType: params.targetType,
            targetId: params.targetId,
            reason: params.reason,
            metadata: params.metadata,
        });
        return c;
    }

    async getCase(id: string) {
        return prisma.moderationCase.findUnique({ where: { id }, include: { actions: true, reporter: { select: { id: true, username: true } } } });
    }

    async listCases(filters: { status?: string; targetType?: string; cursor?: string | null; limit?: number }) {
        const take = Math.min(filters.limit ?? 20, 50);
        const where: any = {};
        if (filters.status) where.status = filters.status;
        if (filters.targetType) where.targetType = filters.targetType;
        if (filters.cursor) where.id = { gt: filters.cursor };
        const rows = await prisma.moderationCase.findMany({ where, take: take + 1, orderBy: { createdAt: "desc" }, include: { reporter: { select: { id: true, username: true } } } });
        const hasMore = rows.length > take;
        const data = hasMore ? rows.slice(0, take) : rows;
        return { data, nextCursor: hasMore ? data[data.length - 1].id : null, hasMore };
    }

    /**
     * Moderators can review/suspend/restore/archive
     * Users cannot directly modify moderation state — enforced here and in character.lifecycle
     */
    async decide(params: { caseId: string; actorId: string; actorRole: string; decision: string; reason?: string | null; metadata?: unknown; ipAddress?: string | null; userAgent?: string | null }) {
        if (!["MODERATOR", "ADMIN", "OWNER"].includes(params.actorRole)) {
            throw new ApiError(403, "Only moderators can decide", "FORBIDDEN");
        }

        const c = await prisma.moderationCase.findUnique({ where: { id: params.caseId } });
        if (!c) throw new ApiError(404, "Moderation case not found", "NOT_FOUND");
        if (c.status === "RESOLVED" || c.status === "DISMISSED") throw new ApiError(400, "Case already resolved", "ALREADY_RESOLVED");

        // Record action
        const action = await prisma.moderationAction.create({
            data: {
                caseId: params.caseId,
                actorId: params.actorId,
                decision: params.decision as any,
                reason: params.reason ?? null,
                metadata: params.metadata as any,
            },
        });

        // Apply side-effect per target
        await this.applyDecision(c as any, params.decision as any, params.actorId, params.actorRole, params.reason);

        // Update case
        const newStatus = ["DISMISSED", "ALLOW"].includes(params.decision) ? "DISMISSED" as const : "RESOLVED" as const;
        await prisma.moderationCase.update({
            where: { id: params.caseId },
            data: { status: newStatus as any, resolvedAt: new Date(), assigneeId: params.actorId },
        });

        await auditService.log({
            actorId: params.actorId,
            actorRole: params.actorRole,
            action: "MODERATION_DECIDED",
            targetType: c.targetType as string,
            targetId: c.targetId,
            reason: params.reason ?? null,
            metadata: { caseId: params.caseId, decision: params.decision },
            ipAddress: params.ipAddress ?? null,
            userAgent: params.userAgent ?? null,
        });

        logger.info({ caseId: params.caseId, decision: params.decision, targetId: c.targetId }, "moderation decided");
        return action;
    }

    private async applyDecision(target: { targetType: string; targetId: string }, decision: string, actorId: string, actorRole: string, reason?: string | null) {
        if (target.targetType === "CHARACTER") {
            const char = await prisma.character.findUnique({ where: { id: target.targetId } });
            if (!char) throw new ApiError(404, "Character not found", "NOT_FOUND");
            switch (decision) {
                case "SUSPEND":
                    if (char.status === "SUSPENDED") return;
                    await prisma.$transaction(async (tx) => {
                        await tx.character.update({ where: { id: char.id }, data: { status: "SUSPENDED" as any } });
                        await tx.outboxEvent.create({ data: { aggregateType: "Character", aggregateId: char.id, eventType: "CharacterSuspended", payload: { characterId: char.id, reason } as any, status: "PENDING" } });
                    });
                    await auditService.log({ actorId, actorRole, action: "CHARACTER_SUSPENDED", targetType: "CHARACTER", targetId: char.id, reason });
                    break;
                case "RESTORE":
                    await prisma.$transaction(async (tx) => {
                        const newStatus = char.status === "SUSPENDED" ? "PUBLISHED" : "DRAFT";
                        await tx.character.update({ where: { id: char.id }, data: { status: newStatus as any } });
                        await tx.outboxEvent.create({ data: { aggregateType: "Character", aggregateId: char.id, eventType: "CharacterRestored", payload: { characterId: char.id } as any, status: "PENDING" } });
                    });
                    await auditService.log({ actorId, actorRole, action: "CHARACTER_RESTORED", targetType: "CHARACTER", targetId: char.id, reason });
                    break;
                case "ARCHIVE":
                    await prisma.$transaction(async (tx) => {
                        await tx.character.update({ where: { id: char.id }, data: { status: "ARCHIVED" as any, archivedAt: new Date() } });
                        await tx.outboxEvent.create({ data: { aggregateType: "Character", aggregateId: char.id, eventType: "CharacterArchived", payload: { characterId: char.id } as any, status: "PENDING" } });
                    });
                    await auditService.log({ actorId, actorRole, action: "CHARACTER_ARCHIVED", targetType: "CHARACTER", targetId: char.id, reason });
                    break;
                case "DELETE":
                    await prisma.character.update({ where: { id: char.id }, data: { status: "DELETED" as any } });
                    await auditService.log({ actorId, actorRole, action: "CHARACTER_DELETED", targetType: "CHARACTER", targetId: char.id, reason });
                    break;
                default:
                    break;
            }
        } else if (target.targetType === "MESSAGE") {
            if (decision === "DELETE" || decision === "BLOCK") {
                // soft delete message (preserve audit but hide content)
                await prisma.message.update({ where: { id: target.targetId }, data: { content: "[removed by moderation]", metadata: { moderated: true, reason } as any } }).catch(() => {});
                await auditService.log({ actorId, actorRole, action: "MESSAGE_REMOVED", targetType: "MESSAGE", targetId: target.targetId, reason });
            }
        } else if (target.targetType === "USER") {
            if (decision === "SUSPEND" || decision === "BAN") {
                await prisma.user.update({ where: { id: target.targetId }, data: { status: "SUSPENDED" as any } });
                await auditService.log({ actorId, actorRole, action: "USER_SUSPENDED", targetType: "USER", targetId: target.targetId, reason });
            } else if (decision === "RESTORE") {
                await prisma.user.update({ where: { id: target.targetId }, data: { status: "ACTIVE" as any } });
                await auditService.log({ actorId, actorRole, action: "USER_RESTORED", targetType: "USER", targetId: target.targetId, reason });
            }
        } else if (target.targetType === "DOCUMENT") {
            if (decision === "DELETE" || decision === "BLOCK") {
                await prisma.knowledgeDocument.update({ where: { id: target.targetId }, data: { status: "DELETED" as any } }).catch(() => {});
                await auditService.log({ actorId, actorRole, action: "DOCUMENT_REMOVED", targetType: "DOCUMENT", targetId: target.targetId, reason });
            }
        }
    }
}

export const moderationService = new ModerationService();
