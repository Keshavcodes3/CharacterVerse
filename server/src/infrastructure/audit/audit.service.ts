import { prisma } from "../database/db.js";
import { logger } from "../../config/pino.js";

export type AuditEntry = {
    actorId?: string | null;
    actorRole?: string | null;
    action: string; // AuditAction enum
    targetType?: string | null;
    targetId?: string | null;
    reason?: string | null;
    metadata?: unknown;
    ipAddress?: string | null;
    userAgent?: string | null;
};

export class AuditService {
    async log(entry: AuditEntry): Promise<void> {
        try {
            await prisma.auditLog.create({
                data: {
                    actorId: entry.actorId ?? null,
                    actorRole: entry.actorRole ?? null,
                    action: entry.action as any,
                    targetType: entry.targetType as any,
                    targetId: entry.targetId ?? null,
                    reason: entry.reason ?? null,
                    metadata: entry.metadata as any,
                    ipAddress: entry.ipAddress ?? null,
                    userAgent: entry.userAgent ?? null,
                },
            });
            logger.info({ action: entry.action, targetId: entry.targetId, actorId: entry.actorId }, "audit logged");
        } catch (err) {
            // Audit must not break main flow, but log failure
            logger.error({ err, entry }, "audit log failed");
        }
    }

    async list(filters: { actorId?: string; targetId?: string; action?: string; limit?: number; cursor?: string | null }) {
        const take = Math.min(filters.limit ?? 50, 100);
        const where: any = {};
        if (filters.actorId) where.actorId = filters.actorId;
        if (filters.targetId) where.targetId = filters.targetId;
        if (filters.action) where.action = filters.action;
        if (filters.cursor) where.id = { gt: filters.cursor };

        const rows = await prisma.auditLog.findMany({
            where,
            take: take + 1,
            orderBy: { createdAt: "desc" },
        });
        const hasMore = rows.length > take;
        const data = hasMore ? rows.slice(0, take) : rows;
        const nextCursor = hasMore ? data[data.length - 1].id : null;
        return { data, nextCursor, hasMore };
    }
}

export const auditService = new AuditService();
