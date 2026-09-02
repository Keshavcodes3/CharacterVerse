export const SESSION_COOKIE_NAME = "cv_session" as const;

export const SESSION_TTL_DAYS = 30 as const;
export const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export const ARGON2_OPTIONS = {
    type: 2 as const, // argon2id
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 8 as const;
export const PASSWORD_MAX_LENGTH = 128 as const;

export const USERNAME_MIN_LENGTH = 3 as const;
export const USERNAME_MAX_LENGTH = 30 as const;
export const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;

export const COOKIE_OPTIONS = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
} as const;
