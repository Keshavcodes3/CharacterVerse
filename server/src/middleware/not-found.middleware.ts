import { Request, Response } from "express";
import { ApiError
    
 } from "../utils/apiError.js";

export const notFoundMiddleware = (
    req: Request,
    _res: Response
) => {
    throw new ApiError(
        404,
        `Route ${req.method} ${req.originalUrl} not found`,
        "ROUTE_NOT_FOUND"
    );
};