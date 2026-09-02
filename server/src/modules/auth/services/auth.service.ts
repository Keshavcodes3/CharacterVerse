import crypto from "node:crypto";
import * as argon2 from "argon2";
import { ApiError } from "../../../utils/apiError.js";
import { logger } from "../../../config/pino.js";
import { SESSION_TTL_MS } from "../../../config/constants.js";
import type { AuthRepository } from "../repositories/auth.repository.js";
import type {
    RegisterInput,
    LoginInput,
    SanitizedUser,
    AuthenticatedUser,
} from "../types/auth.types.js";

function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function generateSessionToken(): string {
    return crypto.randomBytes(32).toString("hex");
}

function sanitizeUser(user: {
    id: string;
    username: string;
    email: string;
    avatarUrl: string | null;
    bio: string | null;
    status: string;
    role: string;
    createdAt: Date;
}): SanitizedUser {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        status: user.status,
        role: user.role,
        createdAt: user.createdAt,
    };
}

export class AuthService {
    constructor(private readonly authRepository: AuthRepository) {}

    async register(
        input: RegisterInput,
        meta: { userAgent?: string | null; ipAddress?: string | null }
    ): Promise<{ user: SanitizedUser; token: string; expiresAt: Date }> {
        const email = input.email.toLowerCase().trim();
        const username = input.username.trim();

        const existingEmail = await this.authRepository.findUserByEmail(email);
        if (existingEmail) {
            throw new ApiError(409, "Email already in use", "EMAIL_ALREADY_EXISTS");
        }

        const existingUsername = await this.authRepository.findUserByUsername(username);
        if (existingUsername) {
            throw new ApiError(409, "Username already in use", "USERNAME_ALREADY_EXISTS");
        }

        const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

        const user = await this.authRepository.createUserWithRelations({
            username,
            email,
            passwordHash,
        });

        const token = generateSessionToken();
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

        await this.authRepository.createSession({
            userId: user.id,
            tokenHash,
            expiresAt,
            userAgent: meta.userAgent ?? null,
            ipAddress: meta.ipAddress ?? null,
        });

        logger.info({ userId: user.id, email: user.email }, "User registered");

        return { user: sanitizeUser(user), token, expiresAt };
    }

    async login(
        input: LoginInput,
        meta: { userAgent?: string | null; ipAddress?: string | null }
    ): Promise<{ user: SanitizedUser; token: string; expiresAt: Date }> {
        const email = input.email.toLowerCase().trim();

        const user = await this.authRepository.findUserByEmail(email);
        if (!user) {
            throw new ApiError(401, "Invalid email or password", "INVALID_CREDENTIALS");
        }

        if (user.status === "SUSPENDED") {
            throw new ApiError(403, "Account is suspended", "ACCOUNT_SUSPENDED");
        }

        if (user.status === "INACTIVE") {
            throw new ApiError(403, "Account is inactive", "ACCOUNT_INACTIVE");
        }

        const valid = await argon2.verify(user.passwordHash, input.password);
        if (!valid) {
            logger.warn({ email }, "Failed login attempt");
            throw new ApiError(401, "Invalid email or password", "INVALID_CREDENTIALS");
        }

        const token = generateSessionToken();
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

        await this.authRepository.createSession({
            userId: user.id,
            tokenHash,
            expiresAt,
            userAgent: meta.userAgent ?? null,
            ipAddress: meta.ipAddress ?? null,
        });

        logger.info({ userId: user.id }, "User logged in");

        return { user: sanitizeUser(user), token, expiresAt };
    }

    async logout(rawToken: string | undefined): Promise<void> {
        if (!rawToken) return;
        const tokenHash = hashToken(rawToken);
        await this.authRepository.deleteSessionByTokenHash(tokenHash);
        logger.info("Session revoked");
    }

    async authenticate(rawToken: string | undefined): Promise<AuthenticatedUser> {
        if (!rawToken) {
            throw new ApiError(401, "Not authenticated", "UNAUTHENTICATED");
        }

        const tokenHash = hashToken(rawToken);
        const session = await this.authRepository.findSessionByTokenHash(tokenHash);

        if (!session) {
            throw new ApiError(401, "Not authenticated", "UNAUTHENTICATED");
        }

        if (session.expiresAt < new Date()) {
            await this.authRepository.deleteSessionByTokenHash(tokenHash);
            throw new ApiError(401, "Session expired", "UNAUTHENTICATED");
        }

        const user = session.user;

        if (user.status === "SUSPENDED") {
            throw new ApiError(403, "Account is suspended", "ACCOUNT_SUSPENDED");
        }

        if (user.status === "INACTIVE") {
            throw new ApiError(403, "Account is inactive", "ACCOUNT_INACTIVE");
        }

        return sanitizeUser(user);
    }

    hashToken(token: string): string {
        return hashToken(token);
    }

    generateSessionToken(): string {
        return generateSessionToken();
    }
}
