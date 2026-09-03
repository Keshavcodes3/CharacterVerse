import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { prisma } from "../infrastructure/database/db.js";
import { AuthRepository } from "../modules/auth/repositories/auth.repository.js";
import { AuthService } from "../modules/auth/services/auth.service.js";
import { SESSION_COOKIE_NAME } from "../config/constants.js";
import { logger } from "../config/pino.js";
import { realtimeManager } from "./realtime.manager.js";

function parseCookie(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(";")) {
        const [k, ...v] = part.trim().split("=");
        if (k) out[k] = decodeURIComponent(v.join("="));
    }
    return out;
}

const authRepo = new AuthRepository(prisma);
const authService = new AuthService(authRepo);

export function attachRealtimeServer(httpServer: HttpServer) {
    const wss = new WebSocketServer({ server: httpServer, path: "/ws", perMessageDeflate: false });

    wss.on("connection", async (ws: WebSocket, req) => {
        const socketId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let userId: string | null = null;

        // Heartbeat
        let isAlive = true;
        const pingInterval = setInterval(() => {
            if (!isAlive) {
                ws.terminate();
                return;
            }
            isAlive = false;
            try { ws.ping(); } catch {}
        }, 30000);
        ws.on("pong", () => { isAlive = true; });

        try {
            // 1. connection authentication — via cookie or query token
            const cookies = parseCookie(req.headers.cookie);
            const token = cookies[SESSION_COOKIE_NAME] ?? new URL(req.url ?? "", `http://${req.headers.host}`).searchParams.get("token");
            if (!token) {
                ws.send(JSON.stringify({ type: "error", payload: { code: "UNAUTHORIZED", message: "Missing token" } }));
                ws.close(1008, "Unauthorized");
                return;
            }
            const user = await authService.authenticate(token as string);
            userId = user.id;
            realtimeManager.register(userId, socketId, ws as any);

            ws.send(JSON.stringify({ type: "connected", payload: { userId, socketId } }));

            // 2. handle client messages — delegate to Chat Application Service, no business logic here
            ws.on("message", async (raw) => {
                let msg: any;
                try { msg = JSON.parse(String(raw)); } catch { ws.send(JSON.stringify({ type: "error", payload: { code: "INVALID_JSON" } })); return; }

                // Expected client events: { type: "message:send", payload: { conversationId, content, idempotencyKey, lastSeenSeq? } }
                // or { type: "conversation:join", payload: { conversationId } }

                if (msg.type === "conversation:join") {
                    const { conversationId } = (msg.payload ?? {}) as { conversationId?: string };
                    if (!conversationId) return;
                    // authorization: must own conversation
                    const conv = await prisma.conversation.findFirst({ where: { id: conversationId as string, userId: userId! } });
                    if (!conv) {
                        ws.send(JSON.stringify({ type: "error", payload: { code: "FORBIDDEN", conversationId } }));
                        return;
                    }
                    ws.send(JSON.stringify({ type: "conversation:joined", payload: { conversationId } }));
                    // replay missed events if client sent lastSeenSeq
                    if (typeof msg.payload?.lastSeenSeq === "number") {
                        const missed = realtimeManager.getMissedEvents(userId!, msg.payload.lastSeenSeq);
                        for (const ev of missed) ws.send(JSON.stringify(ev));
                    }
                } else if (msg.type === "message:send") {
                    const { conversationId, content, idempotencyKey } = (msg.payload ?? {}) as { conversationId?: string; content?: string; idempotencyKey?: string };
                    if (!conversationId || !content) {
                        ws.send(JSON.stringify({ type: "error", payload: { code: "INVALID_MESSAGE" } }));
                        return;
                    }
                    // Delegate to Chat Application Service — keep WS handler thin
                    try {
                        const { aiService } = await import("../modules/ai/ai.service.js");
                        // First, inform client generation started
                        realtimeManager.sendToUser(userId!, "generation:started", { conversationId, idempotencyKey }, { conversationId });

                        // Stream tokens via realtimeManager
                        let full = "";
                        for await (const evt of aiService.chatStream({ conversationId, userId: userId!, content, idempotencyKey })) {
                            if (evt.type === "token") {
                                full += (evt as any).token;
                                realtimeManager.sendToUser(userId!, "generation:token", { conversationId, token: (evt as any).token }, { conversationId });
                            } else if (evt.type === "tool_start") {
                                realtimeManager.sendToUser(userId!, "generation:tool_started", evt, { conversationId });
                            } else if (evt.type === "tool_end") {
                                realtimeManager.sendToUser(userId!, "generation:tool_completed", evt, { conversationId });
                            } else if (evt.type === "error") {
                                realtimeManager.sendToUser(userId!, "generation:failed", { conversationId, error: (evt as any).error }, { conversationId });
                            }
                        }
                        realtimeManager.sendToUser(userId!, "generation:completed", { conversationId, content: full }, { conversationId });
                        // Also send message event
                        realtimeManager.sendToUser(userId!, "message:created", { conversationId, role: "ASSISTANT", content: full }, { conversationId });
                    } catch (err: any) {
                        logger.error({ err, conversationId }, "WS message handler failed");
                        const code = err.message?.includes("busy") ? "CONVERSATION_BUSY" : err.message?.includes("not found") ? "NOT_FOUND" : "GENERATION_FAILED";
                        realtimeManager.sendToUser(userId!, "generation:failed", { conversationId, error: String(err.message ?? err), code }, { conversationId });
                    }
                } else if (msg.type === "ping") {
                    ws.send(JSON.stringify({ type: "pong" }));
                } else {
                    ws.send(JSON.stringify({ type: "error", payload: { code: "UNKNOWN_TYPE" } }));
                }
            });

            ws.on("close", () => {
                clearInterval(pingInterval);
                if (userId) realtimeManager.unregister(userId, socketId);
            });
            ws.on("error", (err) => {
                logger.warn({ err, userId }, "WS error");
            });
        } catch (err) {
            logger.warn({ err }, "WS connection auth failed");
            try { ws.send(JSON.stringify({ type: "error", payload: { code: "UNAUTHORIZED" } })); ws.close(1008, "Unauthorized"); } catch {}
            clearInterval(pingInterval);
        }
    });

    logger.info("Realtime WS server attached at /ws");
    return wss;
}
