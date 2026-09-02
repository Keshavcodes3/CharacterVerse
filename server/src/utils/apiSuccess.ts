import { Response } from "express";

interface ApiSuccessOptions<T> {
    statusCode?: number;
    message?: string;
    data?: T;
    meta?: Record<string, unknown>;
}

export const apiSuccess = <T>(
    res: Response,
    {
        statusCode = 200,
        message = "Success",
        data,
        meta,
    }: ApiSuccessOptions<T>
) => {
    return res.status(statusCode).json({
        success: true,
        message,
        data,
        ...(meta && { meta }),
    });
};