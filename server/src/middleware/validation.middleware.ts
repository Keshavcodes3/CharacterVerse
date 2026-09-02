import { Request, Response, NextFunction } from "express";
import { ZodType, ZodError } from "zod";
import { ApiError } from "../utils/apiError.js";

type ValidationSchema = ZodType<{
    body?: unknown;
    query?: unknown;
    params?: unknown;
    cookies?: unknown;
}>;

export const validate =
    (schema: ValidationSchema) =>
    (req: Request, _res: Response, next: NextFunction): void => {
        try {
            const parsed = schema.parse({
                body: req.body,
                query: req.query,
                params: req.params,
                cookies: req.cookies,
            });

            if (parsed.body !== undefined) req.body = parsed.body;
            if (parsed.query !== undefined) req.query = parsed.query as never;
            if (parsed.params !== undefined) req.params = parsed.params as never;

            return next();
        } catch (err) {
            if (err instanceof ZodError) {
                return next(
                    new ApiError(400, "Validation failed", "VALIDATION_ERROR", {
                        issues: err.issues.map((i) => ({
                            path: i.path.join("."),
                            message: i.message,
                            code: i.code,
                        })),
                    })
                );
            }
            return next(err);
        }
    };
