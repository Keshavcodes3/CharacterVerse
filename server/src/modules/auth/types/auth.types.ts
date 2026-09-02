export interface RegisterInput {
    username: string;
    email: string;
    password: string;
}

export interface LoginInput {
    email: string;
    password: string;
}

export interface SanitizedUser {
    id: string;
    username: string;
    email: string;
    avatarUrl: string | null;
    bio: string | null;
    status: string;
    role: string;
    createdAt: Date;
}

export interface AuthenticatedUser {
    id: string;
    username: string;
    email: string;
    avatarUrl: string | null;
    bio: string | null;
    status: string;
    role: string;
    createdAt: Date;
}

export interface SessionPayload {
    token: string;
    tokenHash: string;
    expiresAt: Date;
}

declare global {
    namespace Express {
        interface Request {
            user?: AuthenticatedUser;
        }
    }
}
