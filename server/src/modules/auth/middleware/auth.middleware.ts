import type { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE_NAME } from "../../../config/constants.js";
import type { AuthService } from "../services/auth.service.js";

export const createAuthMiddleware = (authService: AuthService) => {
    const requireAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        try {
            const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
            const user = await authService.authenticate(token);
            req.user = user;
            return next();
        } catch (err) {
            return next(err);
        }
    };

    return { requireAuth };
};

export type AuthMiddleware = ReturnType<typeof createAuthMiddleware>;
