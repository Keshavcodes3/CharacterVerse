import { logger } from "../config/pino.js";
import { queueManager } from "../infrastructure/queue/queue.js";
import { prisma } from "../infrastructure/database/db.js";
import { notificationService } from "../modules/notifications/notification.service.js";

export type NotificationJob = { userId: string; type: string; title: string; content: string; data?: unknown };

async function handleNotification(job: { data: NotificationJob }) {
    const { userId, type, title, content, data } = job.data;
    // Respect preferences
    const prefs = await prisma.userPreferences.findUnique({ where: { userId } });
    if (prefs) {
        if (type === "SYSTEM" && !prefs.pushNotifications) {
            logger.info({ userId, type }, "notification skipped by preferences");
            return;
        }
    }
    await notificationService.create({ userId, type: type as any, title, content, data });
    // Realtime push via WebSocket manager (if user online)
    const { realtimeManager } = await import("../realtime/realtime.manager.js");
    realtimeManager.sendToUser(userId, "notification", { type, title, content, data });
    logger.info({ userId, type }, "notification delivered");
}

export function startNotificationWorker() {
    queueManager.notifications.process(async (job) => handleNotification(job as any));
    logger.info("Notification worker started (queue: notifications)");
}

export async function enqueueNotification(data: NotificationJob) {
    return queueManager.notifications.add("notify", data, { jobId: `notify-${data.userId}-${data.type}-${Date.now()}`, attempts: 3 });
}
