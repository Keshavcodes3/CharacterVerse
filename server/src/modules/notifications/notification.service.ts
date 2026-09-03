import { prisma } from "../../infrastructure/database/db.js";
import { logger } from "../../config/pino.js";

export type CreateNotificationInput = {
    userId: string;
    type: string; // NotificationType
    title: string;
    content: string;
    data?: unknown;
};

export class NotificationService {
    async create(input: CreateNotificationInput) {
        // Respect NotificationPreference (via UserPreferences)
        const prefs = await prisma.userPreferences.findUnique({ where: { userId: input.userId } });
        if (prefs && input.type === "FOLLOW" && !prefs.pushNotifications) {
            logger.info({ userId: input.userId, type: input.type }, "notification suppressed by preferences");
            return null;
        }

        const notif = await prisma.notification.create({
            data: {
                userId: input.userId,
                type: input.type as any,
                title: input.title,
                content: input.content,
                data: input.data as any,
            },
        });
        logger.info({ notificationId: notif.id, userId: input.userId, type: input.type }, "notification created");
        return notif;
    }

    async list(userId: string, opts: { cursor?: string | null; limit?: number; unreadOnly?: boolean }) {
        const take = Math.min(opts.limit ?? 20, 50);
        const where: any = { userId };
        if (opts.unreadOnly) where.isRead = false;
        if (opts.cursor) where.id = { gt: opts.cursor };
        const rows = await prisma.notification.findMany({ where, take: take + 1, orderBy: { createdAt: "desc" } });
        const hasMore = rows.length > take;
        const data = hasMore ? rows.slice(0, take) : rows;
        return { data, nextCursor: hasMore ? data[data.length - 1].id : null, hasMore };
    }

    async markRead(userId: string, notificationId: string) {
        const n = await prisma.notification.findFirst({ where: { id: notificationId, userId } });
        if (!n) throw new Error("Notification not found");
        return prisma.notification.update({ where: { id: notificationId }, data: { isRead: true } });
    }

    async markAllRead(userId: string) {
        return prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
    }
}

export const notificationService = new NotificationService();
