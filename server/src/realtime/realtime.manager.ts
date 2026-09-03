import { logger } from "../config/pino.js";

type SocketLike = {
    send: (data: string) => void;
    close: () => void;
    readyState: number;
};

export type RealtimeEvent = {
    id: string; // for retry/recover
    seq: number; // monotonic per conversation
    type: string; // message, generation, token, notification etc
    payload: unknown;
    createdAt: string;
};

class RealtimeManager {
    // userId -> Set<socketId> -> socket
    private sockets = new Map<string, Map<string, SocketLike>>();
    // conversationId -> seq counter for ordering
    private seqCounters = new Map<string, number>();
    // userId -> buffered events for reconnect (last 100 per user)
    private buffers = new Map<string, RealtimeEvent[]>();

    // metrics
    metrics = { connections: 0, disconnections: 0, messagesSent: 0, active: 0 };

    register(userId: string, socketId: string, socket: SocketLike) {
        if (!this.sockets.has(userId)) this.sockets.set(userId, new Map());
        this.sockets.get(userId)!.set(socketId, socket);
        this.metrics.connections++;
        this.metrics.active = this.totalSockets();
        logger.info({ userId, socketId }, "realtime connected");
    }

    unregister(userId: string, socketId: string) {
        this.sockets.get(userId)?.delete(socketId);
        if (this.sockets.get(userId)?.size === 0) this.sockets.delete(userId);
        this.metrics.disconnections++;
        this.metrics.active = this.totalSockets();
        logger.info({ userId, socketId }, "realtime disconnected");
    }

    private totalSockets() {
        let n = 0;
        for (const m of this.sockets.values()) n += m.size;
        return n;
    }

    sendToUser(userId: string, type: string, payload: unknown, opts?: { conversationId?: string }) {
        const seq = this.nextSeq(opts?.conversationId ?? `user:${userId}`);
        const event: RealtimeEvent = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            seq,
            type,
            payload,
            createdAt: new Date().toISOString(),
        };
        this.buffer(userId, event);
        const userSockets = this.sockets.get(userId);
        if (!userSockets || userSockets.size === 0) {
            logger.debug({ userId, type }, "realtime no active sockets — buffered");
            return;
        }
        const data = JSON.stringify(event);
        for (const sock of userSockets.values()) {
            try {
                if (sock.readyState === 1) {
                    sock.send(data);
                    this.metrics.messagesSent++;
                }
            } catch (e) {
                logger.warn({ err: e, userId }, "realtime send failed");
            }
        }
    }

    sendToConversation(conversationId: string, userId: string, type: string, payload: unknown) {
        // For now 1-1 conversation, just send to owner userId; extensible to participants
        this.sendToUser(userId, type, payload, { conversationId });
    }

    // For reconnect recovery: client sends lastSeenSeq, server replays missed
    getMissedEvents(userId: string, afterSeq: number): RealtimeEvent[] {
        const buf = this.buffers.get(userId) ?? [];
        return buf.filter((e) => e.seq > afterSeq);
    }

    private nextSeq(key: string): number {
        const cur = this.seqCounters.get(key) ?? 0;
        const next = cur + 1;
        this.seqCounters.set(key, next);
        return next;
    }

    private buffer(userId: string, event: RealtimeEvent) {
        if (!this.buffers.has(userId)) this.buffers.set(userId, []);
        const arr = this.buffers.get(userId)!;
        arr.push(event);
        if (arr.length > 100) arr.shift();
    }

    // Observability
    getMetrics() {
        return { ...this.metrics, bufferedUsers: this.buffers.size };
    }
}

export const realtimeManager = new RealtimeManager();
