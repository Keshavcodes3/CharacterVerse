import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { env } from "../../config/env.js";

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

const connectionString = env.DATABASE_URL;

const adapter = new PrismaPg({ connectionString });

export const prisma =
    globalForPrisma.prisma ?? new PrismaClient({ adapter });

export const db = prisma;

if (env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}
