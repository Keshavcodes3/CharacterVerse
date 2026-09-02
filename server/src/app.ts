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

app.get("/health", (_req, res) => {
    res.status(200).json({
        success: true,
        message: "CharacterVerse API is healthy",
    });
});

// API routes will go here
//
// app.use("/api/v1/auth", authRoutes);
// app.use("/api/v1/users", userRoutes);
// app.use("/api/v1/characters", characterRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;