import type { PrismaClient, User, Session } from "../../../generated/prisma/client.js";

export type UserWithPassword = User;

export type CreateUserInput = {
    username: string;
    email: string;
    passwordHash: string;
};

export type CreateSessionInput = {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
};

export class AuthRepository {
    constructor(private readonly db: PrismaClient) {}

    async findUserByEmail(email: string): Promise<User | null> {
        return this.db.user.findUnique({ where: { email } });
    }

    async findUserByUsername(username: string): Promise<User | null> {
        return this.db.user.findUnique({ where: { username } });
    }

    async findUserById(id: string): Promise<User | null> {
        return this.db.user.findUnique({ where: { id } });
    }

    async createUserWithRelations(input: CreateUserInput): Promise<User> {
        return this.db.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    username: input.username,
                    email: input.email,
                    passwordHash: input.passwordHash,
                },
            });

            await tx.userProfile.create({
                data: {
                    userId: user.id,
                    displayName: input.username,
                },
            });

            await tx.userPreferences.create({
                data: {
                    userId: user.id,
                },
            });

            return user;
        });
    }

    async createSession(input: CreateSessionInput): Promise<Session> {
        return this.db.session.create({
            data: {
                userId: input.userId,
                tokenHash: input.tokenHash,
                expiresAt: input.expiresAt,
                userAgent: input.userAgent ?? null,
                ipAddress: input.ipAddress ?? null,
            },
        });
    }

    async findSessionByTokenHash(tokenHash: string): Promise<(Session & { user: User }) | null> {
        return this.db.session.findUnique({
            where: { tokenHash },
            include: { user: true },
        });
    }

    async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
        await this.db.session.deleteMany({ where: { tokenHash } });
    }

    async deleteExpiredSessions(): Promise<number> {
        const result = await this.db.session.deleteMany({
            where: { expiresAt: { lt: new Date() } },
        });
        return result.count;
    }
}
