import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError.js";
import { logger } from "../config/pino.js";
import { env } from "../config/env.js";

export const errorMiddleware = (
    error: unknown,
    req: Request,
    res: Response,
    _next: NextFunction
) => {
    let statusCode = 500;
    let message = "Internal server error";
    let code = "INTERNAL_SERVER_ERROR";
    let details: unknown;

    if (error instanceof ApiError) {
        statusCode = error.statusCode;
        message = error.message;
        code = error.code;
        details = error.details;
    }

    logger.error(
        {
            err: error,
            method: req.method,
            path: req.originalUrl,
            statusCode,
        },
        "Request failed"
    );

    return res.status(statusCode).json({
        success: false,
        error: {
            code,
            message,
            ...(details !== undefined && { details }),
            ...(env.NODE_ENV === "development" &&
                error instanceof Error && {
                stack: error.stack,
            }),
        },
    });
};