import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";

import { env } from "./config/env.js";
import { logger } from "./config/pino.js";
import { notFoundMiddleware } from "./middleware/not-found.middleware.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import authRoutes from "./modules/auth/auth.routes.js";
import characterRoutes from "./modules/characters/character.routes.js";
import conversationRoutes from "./modules/conversations/conversation.routes.js";
import messageRoutes from "./modules/messages/message.routes.js";
import aiRoutes from "./modules/ai/model.router.js";
import knowledgeRoutes from "./modules/knowledge/knowledge.routes.js";
import discoveryRoutes from "./modules/discovery/discovery.routes.js";
import socialRoutes from "./modules/social/social.routes.js";
import moderationRoutes from "./modules/moderation/moderation.routes.js";
import notificationRoutes from "./modules/notifications/notification.routes.js";
import { largePayloadGuard } from "./middleware/abuse.middleware.js";

const app = express();

app.disable("x-powered-by");

app.use(
    cors({
        origin: env.CLIENT_URL ?? "http://localhost:3000",
        credentials: true,
    })
);

app.use(helmet());
app.use(compression());

app.use(
    express.json({
        limit: "1mb",
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: "1mb",
    })
);

app.use(cookieParser());
app.use(
    //@ts-ignore
    pinoHttp({
        logger,
    })
);

app.use(largePayloadGuard);

app.get("/health", (_req, res) => {
    res.status(200).json({
        success: true,
        message: "CharacterVerse API is healthy",
    });
});

app.get("/metrics", (_req, res) => {
    // simple observability snapshot — in prod would be prometheus
    import("./infrastructure/observability/metrics.js").then(({ metrics }) => {
        res.json(metrics.snapshot());
    }).catch(() => res.json({ error: "metrics unavailable" }));
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/characters", characterRoutes);
app.use("/api/v1/conversations", conversationRoutes);
app.use("/api/v1/conversations", messageRoutes);
app.use("/api/v1/ai", aiRoutes);
app.use("/api/v1", knowledgeRoutes);
app.use("/api/v1", discoveryRoutes);
app.use("/api/v1", socialRoutes);
app.use("/api/v1/moderation", moderationRoutes);
app.use("/api/v1/notifications", notificationRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;