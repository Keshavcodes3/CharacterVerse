import { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { CharacterListFilters } from "./character.types.js";

const characterInclude = {
    personality: true,
    profile: true,
    currentVersion: true,
    versions: { orderBy: { version: "desc" as const }, take: 5 },
    examples: true,
    creator: { select: { id: true, username: true, avatarUrl: true } },
    _count: { select: { likes: true, bookmarks: true } },
} as const;

export class CharacterRepository {
    constructor(private readonly db: PrismaClient) {}

    async create(data: Prisma.CharacterCreateInput) {
        return this.db.character.create({
            data,
            include: characterInclude,
        });
    }

    async createWithRelations(input: {
        creatorId: string;
        name: string;
        slug: string;
        description: string;
        greeting: string;
        avatarUrl?: string | null;
        visibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
        category: string[];
        tags: string[];
        personality?: {
            traits?: unknown;
            backstory?: string;
            personality?: string;
            lore?: string | null;
            knowledge?: string | null;
            scenario?: string | null;
            exampleDialogues?: unknown | null;
        };
        examples?: Array<{ title?: string; content: string; isDialogue?: boolean }>;
    }) {
        return this.db.character.create({
            data: {
                creator: { connect: { id: input.creatorId } },
                name: input.name,
                slug: input.slug,
                description: input.description,
                greeting: input.greeting,
                avatarUrl: input.avatarUrl ?? null,
                visibility: input.visibility,
                category: input.category,
                tags: input.tags,
                personality: input.personality
                    ? {
                          create: {
                              traits: (input.personality.traits as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                              backstory: input.personality.backstory ?? "",
                              personality: input.personality.personality ?? "",
                              lore: input.personality.lore ?? null,
                              knowledge: input.personality.knowledge ?? null,
                              scenario: input.personality.scenario ?? null,
                              exampleDialogues:
                                  (input.personality.exampleDialogues as Prisma.InputJsonValue) ??
                                  Prisma.JsonNull,
                          },
                      }
                    : undefined,
                examples: input.examples?.length
                    ? {
                          createMany: {
                              data: input.examples.map((e) => ({
                                  title: e.title ?? null,
                                  content: e.content,
                                  isDialogue: e.isDialogue ?? true,
                              })),
                          },
                      }
                    : undefined,
            },
            include: characterInclude,
        });
    }

    async findById(id: string) {
        return this.db.character.findUnique({
            where: { id },
            include: characterInclude,
        });
    }

    async findBySlug(slug: string) {
        return this.db.character.findUnique({
            where: { slug },
            include: characterInclude,
        });
    }

    async findByIdOrSlug(idOrSlug: string) {
        // Try slug first if it looks like slug, else try both with OR via fallback
        // We do two queries; prisma can't OR unique fields easily for findUnique
        let char = await this.findBySlug(idOrSlug);
        if (char) return char;
        // If not found and looks like uuid try id
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
        if (isUuid) {
            char = await this.findById(idOrSlug);
        }
        // As last resort, if idOrSlug not uuid but also not found as slug, try id anyway
        if (!char && !isUuid) {
            // could be an id that is not uuid? schema uses uuid default, but check
            char = await this.db.character.findFirst({
                where: { id: idOrSlug },
                include: characterInclude,
            });
        }
        return char;
    }

    async slugExists(slug: string, excludeId?: string) {
        const existing = await this.db.character.findUnique({ where: { slug } });
        if (!existing) return false;
        if (excludeId && existing.id === excludeId) return false;
        return true;
    }

    async list(filters: CharacterListFilters & { status?: string }) {
        const where: Prisma.CharacterWhereInput = {};

        if (filters.visibility) {
            where.visibility = filters.visibility;
        }
        if ((filters as unknown as Record<string, unknown>).status) where.status = (filters as unknown as Record<string, unknown>).status as never;
        else where.status = { not: "DELETED" } as never;

        if (filters.creatorId) {
            where.creatorId = filters.creatorId;
        }

        if (filters.category) {
            where.category = { has: filters.category };
        }

        if (filters.tags?.length) {
            where.tags = { hasSome: filters.tags };
        }

        if (filters.search) {
            const s = filters.search;
            where.OR = [
                { name: { contains: s, mode: "insensitive" } },
                { description: { contains: s, mode: "insensitive" } },
                { tags: { has: s } },
            ];
        }

        const [total, data] = await Promise.all([
            this.db.character.count({ where }),
            this.db.character.findMany({
                where,
                include: characterInclude,
                orderBy: { [filters.sortBy]: filters.order },
                skip: (filters.page - 1) * filters.limit,
                take: filters.limit,
            }),
        ]);

        return {
            data,
            meta: {
                page: filters.page,
                limit: filters.limit,
                total,
                totalPages: Math.ceil(total / filters.limit),
            },
        };
    }
    // list without @ts-expect-error - filters.status handled via where.status directly

    async listPublic(filters: Omit<CharacterListFilters, "visibility">) {
        return this.list({ ...filters, visibility: "PUBLIC" });
    }

    async update(
        id: string,
        data: Prisma.CharacterUpdateInput,
        personality?: {
            traits?: unknown;
            backstory?: string;
            personality?: string;
            lore?: string | null;
            knowledge?: string | null;
            scenario?: string | null;
            exampleDialogues?: unknown | null;
        },
        examples?: Array<{ title?: string; content: string; isDialogue?: boolean }>
    ) {
        // Handle personality upsert separately, then character update in transaction
        return this.db.$transaction(async (tx) => {
            if (personality !== undefined) {
                await tx.characterPersonality.upsert({
                    where: { characterId: id },
                    create: {
                        characterId: id,
                        traits: (personality.traits as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                        backstory: personality.backstory ?? "",
                        personality: personality.personality ?? "",
                        lore: personality.lore ?? null,
                        knowledge: personality.knowledge ?? null,
                        scenario: personality.scenario ?? null,
                        exampleDialogues:
                            (personality.exampleDialogues as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                    },
                    update: {
                        ...(personality.traits !== undefined && {
                            traits: personality.traits as Prisma.InputJsonValue,
                        }),
                        ...(personality.backstory !== undefined && { backstory: personality.backstory }),
                        ...(personality.personality !== undefined && { personality: personality.personality }),
                        ...(personality.lore !== undefined && { lore: personality.lore }),
                        ...(personality.knowledge !== undefined && { knowledge: personality.knowledge }),
                        ...(personality.scenario !== undefined && { scenario: personality.scenario }),
                        ...(personality.exampleDialogues !== undefined && {
                            exampleDialogues: personality.exampleDialogues as Prisma.InputJsonValue,
                        }),
                    },
                });
            }

            if (examples !== undefined) {
                await tx.characterExample.deleteMany({ where: { characterId: id } });
                if (examples.length > 0) {
                    await tx.characterExample.createMany({
                        data: examples.map((e) => ({
                            characterId: id,
                            title: e.title ?? null,
                            content: e.content,
                            isDialogue: e.isDialogue ?? true,
                        })),
                    });
                }
            }

            return tx.character.update({
                where: { id },
                data,
                include: characterInclude,
            });
        });
    }

    async updateWithVersionBump(
        id: string,
        data: Prisma.CharacterUpdateInput,
        personality?: {
            traits?: unknown;
            backstory?: string;
            personality?: string;
            lore?: string | null;
            knowledge?: string | null;
            scenario?: string | null;
            exampleDialogues?: unknown | null;
        },
        examples?: Array<{ title?: string; content: string; isDialogue?: boolean }>,
        actorId?: string,
    ) {
        return this.db.$transaction(async (tx) => {
            if (personality !== undefined) {
                await tx.characterPersonality.upsert({
                    where: { characterId: id },
                    create: {
                        characterId: id,
                        traits: (personality.traits as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                        backstory: personality.backstory ?? "",
                        personality: personality.personality ?? "",
                        lore: personality.lore ?? null,
                        knowledge: personality.knowledge ?? null,
                        scenario: personality.scenario ?? null,
                        exampleDialogues: (personality.exampleDialogues as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                    },
                    update: {
                        ...(personality.traits !== undefined && { traits: personality.traits as Prisma.InputJsonValue }),
                        ...(personality.backstory !== undefined && { backstory: personality.backstory }),
                        ...(personality.personality !== undefined && { personality: personality.personality }),
                        ...(personality.lore !== undefined && { lore: personality.lore }),
                        ...(personality.knowledge !== undefined && { knowledge: personality.knowledge }),
                        ...(personality.scenario !== undefined && { scenario: personality.scenario }),
                        ...(personality.exampleDialogues !== undefined && { exampleDialogues: personality.exampleDialogues as Prisma.InputJsonValue }),
                    },
                });
            }
            if (examples !== undefined) {
                await tx.characterExample.deleteMany({ where: { characterId: id } });
                if (examples.length > 0) await tx.characterExample.createMany({ data: examples.map((e) => ({ characterId: id, title: e.title ?? null, content: e.content, isDialogue: e.isDialogue ?? true })) });
            }

            const current = await tx.character.findUnique({ where: { id }, include: { personality: true, profile: true, examples: true } });
            if (!current) throw new Error("Character not found");

            const updated = await tx.character.update({
                where: { id },
                data: { ...data, version: { increment: 1 } },
                include: { personality: true, profile: true, examples: true },
            });

            // snapshot new version
            const version = await tx.characterVersion.create({
                data: {
                    characterId: id,
                    version: updated.version,
                    name: updated.name,
                    description: updated.description,
                    greeting: updated.greeting,
                    avatarUrl: updated.avatarUrl,
                    personalitySnapshot: updated.personality as unknown as Prisma.InputJsonValue,
                    profileSnapshot: updated.profile as unknown as Prisma.InputJsonValue,
                    examplesSnapshot: updated.examples as unknown as Prisma.InputJsonValue,
                    tags: updated.tags,
                    category: updated.category,
                    createdBy: actorId,
                },
            });
            await tx.character.update({ where: { id }, data: { currentVersionId: version.id } });

            await tx.outboxEvent.create({
                data: {
                    aggregateType: "Character",
                    aggregateId: id,
                    eventType: "CharacterUpdated",
                    payload: { characterId: id, version: updated.version } as unknown as Prisma.InputJsonValue,
                    status: "PENDING",
                },
            });

            return tx.character.findUnique({ where: { id }, include: characterInclude });
        });
    }

    async transitionStatus(id: string, to: "PUBLISHED" | "ARCHIVED" | "SUSPENDED" | "DRAFT" | "DELETED", eventType: string) {
        return this.db.$transaction(async (tx) => {
            const data: Record<string, unknown> = { status: to };
            if (to === "PUBLISHED") data.publishedAt = new Date();
            if (to === "ARCHIVED") data.archivedAt = new Date();
            const updated = await tx.character.update({ where: { id }, data: data as never, include: characterInclude });
            await tx.outboxEvent.create({
                data: { aggregateType: "Character", aggregateId: id, eventType, payload: { characterId: id, status: to } as unknown as Prisma.InputJsonValue, status: "PENDING" },
            });
            return updated;
        });
    }

    async delete(id: string) {
        return this.db.character.delete({ where: { id } });
    }

    // Likes
    async isLiked(userId: string, characterId: string) {
        const like = await this.db.like.findUnique({
            where: { userId_characterId: { userId, characterId } },
        });
        return !!like;
    }

    async like(userId: string, characterId: string) {
        return this.db.like.create({ data: { userId, characterId } });
    }

    async unlike(userId: string, characterId: string) {
        return this.db.like.delete({ where: { userId_characterId: { userId, characterId } } });
    }

    async countLikes(characterId: string) {
        return this.db.like.count({ where: { characterId } });
    }

    // Bookmarks
    async isBookmarked(userId: string, characterId: string) {
        const bm = await this.db.bookmark.findUnique({
            where: { userId_characterId: { userId, characterId } },
        });
        return !!bm;
    }

    async bookmark(userId: string, characterId: string) {
        return this.db.bookmark.create({ data: { userId, characterId } });
    }

    async unbookmark(userId: string, characterId: string) {
        return this.db.bookmark.delete({ where: { userId_characterId: { userId, characterId } } });
    }

    async countBookmarks(characterId: string) {
        return this.db.bookmark.count({ where: { characterId } });
    }
}
