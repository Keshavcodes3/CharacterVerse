import { prisma } from "../../infrastructure/database/db.js";
import { ApiError } from "../../utils/apiError.js";

export class ReportService {
    async report(params: { reporterId: string; characterId: string; reason: string; description?: string | null; metadata?: unknown }) {
        const char = await prisma.character.findUnique({ where: { id: params.characterId }, select: { id: true } });
        if (!char) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");

        // Prevent abusive duplicate reports — unique on (reporterId, characterId, reason) + rate limit 5 per day
        const recentCount = await prisma.report.count({
            where: { reporterId: params.reporterId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        });
        if (recentCount >= 5) throw new ApiError(429, "Too many reports, try again later", "RATE_LIMITED");

        try {
            const report = await prisma.$transaction(async (tx) => {
                const r = await tx.report.create({
                    data: {
                        reporterId: params.reporterId,
                        characterId: params.characterId,
                        reason: params.reason as any,
                        description: params.description ?? null,
                        metadata: params.metadata as any,
                        status: "PENDING",
                    },
                });
                // Create generic moderation case per spec §1
                await tx.moderationCase.create({
                    data: {
                        targetType: "CHARACTER" as any,
                        targetId: params.characterId,
                        reason: params.reason as any,
                        description: params.description ?? null,
                        reporterId: params.reporterId,
                        metadata: { reportId: r.id, ... (params.metadata as any ?? {}) } as any,
                    },
                });
                await tx.auditLog.create({
                    data: {
                        actorId: params.reporterId,
                        action: "REPORT_CREATED" as any,
                        targetType: "CHARACTER" as any,
                        targetId: params.characterId,
                        reason: params.reason,
                        metadata: { reportId: r.id } as any,
                    },
                });
                return r;
            });
            return report;
        } catch (e: any) {
            if (e.code === "P2002") {
                throw new ApiError(409, "You have already reported this character for this reason", "DUPLICATE_REPORT");
            }
            throw e;
        }
    }

    async listForModeration(filters: { status?: string; characterId?: string; cursor?: string | null; limit?: number }) {
        const take = Math.min(filters.limit ?? 20, 50);
        const where: any = {};
        if (filters.status) where.status = filters.status;
        if (filters.characterId) where.characterId = filters.characterId;
        if (filters.cursor) where.id = { gt: filters.cursor };

        const rows = await prisma.report.findMany({
            where,
            take: take + 1,
            orderBy: { createdAt: "desc" },
            include: { reporter: { select: { id: true, username: true } }, character: { select: { id: true, name: true, slug: true } } },
        });
        const hasMore = rows.length > take;
        const data = hasMore ? rows.slice(0, take) : rows;
        const nextCursor = hasMore ? data[data.length - 1].id : null;
        return { data, nextCursor, hasMore };
    }

    async updateStatus(reportId: string, status: "REVIEWED" | "DISMISSED" | "ACTIONED", reviewedBy: string) {
        return prisma.report.update({
            where: { id: reportId },
            data: { status: status as any, reviewedBy, reviewedAt: new Date() },
        });
    }
}

export const reportService = new ReportService();
