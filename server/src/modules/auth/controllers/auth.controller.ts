import type { Request, Response } from "express";
import { env } from "../../../config/env.js";
import { SESSION_COOKIE_NAME } from "../../../config/constants.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { apiSuccess } from "../../../utils/apiSuccess.js";
import type { AuthService } from "../services/auth.service.js";

function getSessionCookieOptions(expiresAt: Date) {
    return {
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: "lax" as const,
        path: "/",
        expires: expiresAt,
    };
}

function getClearedCookieOptions() {
    return {
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: "lax" as const,
        path: "/",
        expires: new Date(0),
    };
}

export class AuthController {
    constructor(private readonly authService: AuthService) {}

    register = asyncHandler(async (req: Request, res: Response) => {
        const { username, email, password } = req.body as {
            username: string;
            email: string;
            password: string;
        };

        const userAgent = req.get("user-agent") ?? null;
        const ipAddress = req.ip ?? null;

        const { user, token, expiresAt } = await this.authService.register(
            { username, email, password },
            { userAgent, ipAddress }
        );

        res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions(expiresAt));

        return apiSuccess(res, {
            statusCode: 201,
            message: "Registration successful",
            data: { user },
        });
    });

    login = asyncHandler(async (req: Request, res: Response) => {
        const { email, password } = req.body as { email: string; password: string };

        const userAgent = req.get("user-agent") ?? null;
        const ipAddress = req.ip ?? null;

        const { user, token, expiresAt } = await this.authService.login(
            { email, password },
            { userAgent, ipAddress }
        );

        res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions(expiresAt));

        return apiSuccess(res, {
            message: "Login successful",
            data: { user },
        });
    });

    logout = asyncHandler(async (req: Request, res: Response) => {
        const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
        await this.authService.logout(token);
        res.cookie(SESSION_COOKIE_NAME, "", getClearedCookieOptions());
        return apiSuccess(res, { message: "Logout successful" });
    });

    me = asyncHandler(async (req: Request, res: Response) => {
        const user = req.user;
        return apiSuccess(res, {
            message: "Current user",
            data: { user },
        });
    });
}
