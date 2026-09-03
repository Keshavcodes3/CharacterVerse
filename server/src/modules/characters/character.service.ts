import crypto from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { ApiError } from "../../utils/apiError.js";
import type { CharacterRepository } from "./character.repository.js";
import type { CharacterVersionRepository } from "./characterVersion.repository.js";
import type { CreateCharacterDTO, UpdateCharacterDTO, CharacterListFilters } from "./character.types.js";
import { assertTransition, assertCanPublish, canTransition } from "./character.lifecycle.js";
import { OutboxEventTypes } from "../../infrastructure/outbox/outbox.repository.js";
import { EnhanceCharacterUseCase } from "../ai/usecases/enhanceCharacter.usecase.js";
import { prisma } from "../../infrastructure/database/db.js";
import { logger } from "../../config/pino.js";
import { normalizeTags, normalizeCategories } from "./tag.utils.js";

function slugify(input: string): string {
    return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-").slice(0, 80);
}
function generateUniqueSuffix(): string { return crypto.randomBytes(3).toString("hex"); }

export class CharacterService {
    constructor(
        private readonly repo: CharacterRepository,
        private readonly versionRepo: CharacterVersionRepository,
        private readonly enhanceUseCase: EnhanceCharacterUseCase = new EnhanceCharacterUseCase(),
    ) {}

    private async ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
        let slug = base; let exists = await this.repo.slugExists(slug, excludeId); let attempts = 0;
        while (exists && attempts < 5) { slug = `${base}-${generateUniqueSuffix()}`; exists = await this.repo.slugExists(slug, excludeId); attempts++; }
        if (exists) slug = `${base}-${Date.now().toString(36)}`;
        return slug;
    }

    /** Core creation: validate -> Mistral enhance -> validate spec -> TX (character + version + outbox) */
    async create(dto: CreateCharacterDTO) {
        const baseSlug = dto.slug ? slugify(dto.slug) : slugify(dto.name);
        if (!baseSlug) throw new ApiError(400, "Invalid slug derived from name", "INVALID_SLUG");

        // Check owner exists is enforced via FK; optionally verify user exists quickly
        // 1. Enhance via Mistral (compiler) — graceful fallback if provider down
        let spec: Awaited<ReturnType<EnhanceCharacterUseCase["execute"]>> | null = null;
        try {
            spec = await this.enhanceUseCase.execute({
                name: dto.name,
                description: dto.description,
                personality: dto.personality?.personality ?? null,
                greeting: dto.greeting,
                category: dto.category,
                tags: dto.tags,
                scenario: dto.personality?.scenario ?? null,
                lore: dto.personality?.lore ?? null,
                nsfwAllowed: false,
            });
        } catch (e) {
            logger.warn({ err: e }, "Enhancement failed, using fallback spec");
            spec = this.enhanceUseCase.fallback({
                name: dto.name, description: dto.description,
                personality: dto.personality?.personality ?? null,
                greeting: dto.greeting, category: dto.category, tags: dto.tags,
                scenario: dto.personality?.scenario ?? null, lore: dto.personality?.lore ?? null,
            }) as never;
        }

        const slug = await this.ensureUniqueSlug(baseSlug);

        // 2. Transaction: character + personality + profile + version + outbox
        const normalizedTags = normalizeTags(spec!.tags);
        const normalizedCategory = normalizeCategories(spec!.category);
        const result = await prisma.$transaction(async (tx) => {
            const character = await tx.character.create({
                data: {
                    creatorId: dto.creatorId,
                    name: spec!.name,
                    slug,
                    description: spec!.description,
                    greeting: spec!.greeting,
                    avatarUrl: dto.avatarUrl ?? null,
                    visibility: dto.visibility ?? "PUBLIC",
                    status: "DRAFT",
                    category: normalizedCategory,
                    tags: normalizedTags,
                    personality: {
                        create: {
                            traits: spec!.traits as unknown as Prisma.InputJsonValue,
                            backstory: spec!.backstory,
                            personality: spec!.personality,
                            lore: spec!.lore ?? null,
                            knowledge: spec!.knowledge ?? null,
                            scenario: spec!.scenario ?? null,
                            exampleDialogues: spec!.exampleDialogues as unknown as Prisma.InputJsonValue,
                        },
                    },
                    profile: {
                        create: {
                            motivations: spec!.motivations,
                            fears: spec!.fears,
                            strengths: spec!.strengths,
                            weaknesses: spec!.weaknesses,
                            interests: spec!.interests,
                            dislikes: spec!.dislikes,
                            speechStyle: spec!.speechStyle,
                            vocabulary: spec!.vocabulary,
                            emotionalTendencies: spec!.emotionalTendencies,
                            behavioralRules: spec!.behavioralRules as unknown as Prisma.InputJsonValue,
                            conversationalRules: spec!.conversationalRules as unknown as Prisma.InputJsonValue,
                            relationshipStyle: spec!.relationshipStyle,
                            summary: spec!.summary,
                        },
                    },
                },
                include: { personality: true, profile: true, examples: true, creator: { select: { id: true, username: true, avatarUrl: true } }, _count: { select: { likes: true, bookmarks: true } } },
            });

            // create initial version
            const version = await tx.characterVersion.create({
                data: {
                    characterId: character.id,
                    version: 1,
                    name: character.name,
                    description: character.description,
                    greeting: character.greeting,
                    avatarUrl: character.avatarUrl,
                    personalitySnapshot: (character.personality as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                    profileSnapshot: (character.profile as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
                    examplesSnapshot: spec!.examples as unknown as Prisma.InputJsonValue,
                    tags: character.tags,
                    category: character.category,
                    createdBy: dto.creatorId,
                },
            });

            await tx.character.update({ where: { id: character.id }, data: { currentVersionId: version.id } });

            // create examples if any
            if (spec!.examples?.length) {
                await tx.characterExample.createMany({
                    data: spec!.examples.map((e) => ({ characterId: character.id, title: e.title ?? null, content: e.content, isDialogue: e.isDialogue ?? true })),
                });
            }

            await tx.outboxEvent.create({
                data: {
                    aggregateType: "Character",
                    aggregateId: character.id,
                    eventType: OutboxEventTypes.CharacterCreated,
                    payload: { characterId: character.id, slug: character.slug, creatorId: dto.creatorId, version: 1 } as unknown as Prisma.InputJsonValue,
                    status: "PENDING",
                },
            });

            return tx.character.findUnique({
                where: { id: character.id },
                include: { personality: true, profile: true, examples: true, versions: true, currentVersion: true, creator: { select: { id: true, username: true, avatarUrl: true } }, _count: { select: { likes: true, bookmarks: true } } },
            });
        });

        return result;
    }

    async getByIdOrSlug(idOrSlug: string, requesterId?: string, requesterRole?: string) {
        const character = await this.repo.findByIdOrSlug(idOrSlug);
        if (!character) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        if (character.status === "DELETED") throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        const isOwner = character.creatorId === requesterId;
        const isAdmin = requesterRole === "ADMIN" || requesterRole === "OWNER" || requesterRole === "MODERATOR";
        if (character.visibility === "PRIVATE" && !isOwner && !isAdmin) throw new ApiError(403, "This character is private", "FORBIDDEN");
        if (character.status === "SUSPENDED" && !isOwner && !isAdmin) throw new ApiError(403, "Character suspended", "SUSPENDED");
        if (character.status === "ARCHIVED" && !isOwner && !isAdmin) throw new ApiError(403, "Character archived", "FORBIDDEN");
        return character;
    }

    async list(filters: CharacterListFilters, requesterId?: string) {
        const effectiveVisibility = (() => {
            if (filters.creatorId && filters.creatorId === requesterId) return undefined;
            if (filters.visibility) {
                if (filters.visibility === "PUBLIC") return "PUBLIC";
                if (!requesterId) return "PUBLIC";
                return "PUBLIC";
            }
            if (filters.creatorId) return undefined;
            return "PUBLIC" as const;
        })();
        const effectiveFilters: CharacterListFilters = { ...filters, visibility: effectiveVisibility as never, tags: filters.tags as unknown as string[] | undefined };
        if (filters.creatorId === requesterId) delete (effectiveFilters as Partial<CharacterListFilters>).visibility;
        else if (!filters.creatorId && effectiveVisibility === "PUBLIC") effectiveFilters.visibility = "PUBLIC";
        return this.repo.list({ ...effectiveFilters, status: "PUBLISHED" as never });
    }

    async listMyCharacters(userId: string, filters: Omit<CharacterListFilters, "creatorId" | "visibility">) {
        return this.repo.list({ ...filters, creatorId: userId, visibility: undefined });
    }

    async update(idOrSlug: string, userId: string, dto: UpdateCharacterDTO, requesterRole?: string) {
        const existing = await this.repo.findByIdOrSlug(idOrSlug);
        if (!existing) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        const isOwner = existing.creatorId === userId;
        const isAdmin = requesterRole === "ADMIN" || requesterRole === "OWNER";
        if (!isOwner && !isAdmin) throw new ApiError(403, "Not authorized to update this character", "FORBIDDEN");
        if (existing.status === "DELETED") throw new ApiError(400, "Cannot update deleted character", "INVALID_STATUS");

        const data: Record<string, unknown> = {};
        if (dto.name !== undefined) data.name = dto.name.trim();
        if (dto.description !== undefined) data.description = dto.description;
        if (dto.greeting !== undefined) data.greeting = dto.greeting;
        if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
        if (dto.visibility !== undefined) data.visibility = dto.visibility;
        if (dto.category !== undefined) data.category = normalizeCategories(dto.category);
        if (dto.tags !== undefined) data.tags = normalizeTags(dto.tags);

        const updated = await this.repo.updateWithVersionBump(existing.id, data as never, dto.personality as never, dto.examples, userId);
        // outbox in same transaction handled inside repo
        return updated;
    }

    // Lifecycle — moderation state changes are audited; users cannot directly set SUSPENDED (moderator only)
    async publish(idOrSlug: string, userId: string, role?: string) {
        const c = await this.repo.findByIdOrSlug(idOrSlug);
        if (!c) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        if (c.creatorId !== userId && role !== "ADMIN" && role !== "OWNER") throw new ApiError(403, "Forbidden", "FORBIDDEN");
        assertTransition(c.status as never, "PUBLISHED");
        assertCanPublish({ name: c.name, description: c.description, greeting: c.greeting, personality: (c as unknown as { personality?: { personality?: string } }).personality?.personality });
        const res = await this.repo.transitionStatus(c.id, "PUBLISHED", OutboxEventTypes.CharacterPublished);
        const { auditService } = await import("../../infrastructure/audit/audit.service.js");
        await auditService.log({ actorId: userId, actorRole: role ?? null, action: "CHARACTER_PUBLISHED", targetType: "CHARACTER", targetId: c.id });
        return res;
    }
    async unpublish(idOrSlug: string, userId: string, role?: string) {
        const c = await this.repo.findByIdOrSlug(idOrSlug);
        if (!c) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        if (c.creatorId !== userId && role !== "ADMIN" && role !== "OWNER") throw new ApiError(403, "Forbidden", "FORBIDDEN");
        // unpublish = PUBLISHED -> DRAFT? spec says PUBLISHED -> ARCHIVED or DRAFT for unpublish; we implement PUBLISHED -> DRAFT via ARCHIVED then DRAFT?
        // We'll allow PUBLISHED -> ARCHIVED as unpublish, and SUSPENDED -> PUBLISHED re-publish
        assertTransition(c.status as never, "ARCHIVED");
        return this.repo.transitionStatus(c.id, "ARCHIVED", OutboxEventTypes.CharacterArchived);
    }
    async archive(idOrSlug: string, userId: string, role?: string) {
        const c = await this.repo.findByIdOrSlug(idOrSlug);
        if (!c) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        if (c.creatorId !== userId && role !== "ADMIN" && role !== "OWNER") throw new ApiError(403, "Forbidden", "FORBIDDEN");
        assertTransition(c.status as never, "ARCHIVED");
        return this.repo.transitionStatus(c.id, "ARCHIVED", OutboxEventTypes.CharacterArchived);
    }
    async suspend(idOrSlug: string, adminId: string, role?: string) {
        if (role !== "ADMIN" && role !== "OWNER" && role !== "MODERATOR") throw new ApiError(403, "Only moderators can suspend", "FORBIDDEN");
        const c = await this.repo.findByIdOrSlug(idOrSlug);
        if (!c) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        assertTransition(c.status as never, "SUSPENDED");
        const res = await this.repo.transitionStatus(c.id, "SUSPENDED", OutboxEventTypes.CharacterSuspended);
        const { auditService } = await import("../../infrastructure/audit/audit.service.js");
        await auditService.log({ actorId: adminId, actorRole: role ?? null, action: "CHARACTER_SUSPENDED", targetType: "CHARACTER", targetId: c.id });
        return res;
    }
    async restore(idOrSlug: string, userId: string, role?: string) {
        const c = await this.repo.findByIdOrSlug(idOrSlug);
        if (!c) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        // ARCHIVED -> DRAFT
        if (c.status === "ARCHIVED") {
            if (c.creatorId !== userId && role !== "ADMIN" && role !== "OWNER") throw new ApiError(403, "Forbidden", "FORBIDDEN");
            assertTransition(c.status as never, "DRAFT");
            const res = await this.repo.transitionStatus(c.id, "DRAFT", OutboxEventTypes.CharacterUpdated);
            const { auditService } = await import("../../infrastructure/audit/audit.service.js");
            await auditService.log({ actorId: userId, actorRole: role ?? null, action: "CHARACTER_RESTORED", targetType: "CHARACTER", targetId: c.id });
            return res;
        }
        if (c.status === "SUSPENDED") {
            if (role !== "ADMIN" && role !== "OWNER" && role !== "MODERATOR") throw new ApiError(403, "Forbidden", "FORBIDDEN");
            assertTransition(c.status as never, "PUBLISHED");
            const res = await this.repo.transitionStatus(c.id, "PUBLISHED", OutboxEventTypes.CharacterPublished);
            const { auditService } = await import("../../infrastructure/audit/audit.service.js");
            await auditService.log({ actorId: userId, actorRole: role ?? null, action: "CHARACTER_RESTORED", targetType: "CHARACTER", targetId: c.id });
            return res;
        }
        throw new ApiError(400, `Cannot restore from ${c.status}`, "INVALID_STATUS_TRANSITION");
    }

    async delete(idOrSlug: string, userId: string, role?: string) {
        const existing = await this.repo.findByIdOrSlug(idOrSlug);
        if (!existing) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        if (existing.creatorId !== userId && role !== "ADMIN" && role !== "OWNER") throw new ApiError(403, "Not authorized to delete this character", "FORBIDDEN");
        // soft delete via status DELETED
        if (!canTransition(existing.status as never, "DELETED")) throw new ApiError(400, `Cannot delete from ${existing.status}`, "INVALID_STATUS_TRANSITION");
        await this.repo.transitionStatus(existing.id, "DELETED", OutboxEventTypes.CharacterDeleted);
    }

    async duplicate(idOrSlug: string, userId: string) {
        const c = await this.repo.findByIdOrSlug(idOrSlug);
        if (!c) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        if (c.visibility === "PRIVATE" && c.creatorId !== userId) throw new ApiError(403, "Cannot duplicate private character", "FORBIDDEN");
        const baseSlug = slugify(c.name + "-copy");
        const slug = await this.ensureUniqueSlug(baseSlug);
        return prisma.$transaction(async (tx) => {
            const dup = await tx.character.create({
                data: {
                    creatorId: userId, name: `${c.name} (Copy)`, slug, description: c.description, greeting: c.greeting, avatarUrl: c.avatarUrl, visibility: "PRIVATE", status: "DRAFT", category: c.category, tags: c.tags,
                    personality: c.personality ? { create: { traits: c.personality.traits as never, backstory: c.personality.backstory, personality: c.personality.personality, lore: c.personality.lore, knowledge: c.personality.knowledge, scenario: c.personality.scenario, exampleDialogues: c.personality.exampleDialogues as never } } : undefined,
                    profile: (c as unknown as { profile?: Record<string, unknown> }).profile ? { create: { ...((c as unknown as { profile: Record<string, unknown> }).profile as Record<string, unknown>), id: undefined, characterId: undefined } as never } : undefined,
                },
                include: { personality: true, profile: true, examples: true },
            });
            if (c.examples?.length) await tx.characterExample.createMany({ data: c.examples.map((e) => ({ characterId: dup.id, title: e.title, content: e.content, isDialogue: e.isDialogue })) });
            await tx.outboxEvent.create({ data: { aggregateType: "Character", aggregateId: dup.id, eventType: OutboxEventTypes.CharacterCreated, payload: { characterId: dup.id, duplicatedFrom: c.id } as never, status: "PENDING" } });
            return dup;
        });
    }

    async search(filters: CharacterListFilters & { status?: string }, requesterId?: string) {
        return this.list(filters as never, requesterId);
    }

    // likes/bookmarks — favorites with idempotent counter (no drift under retries)
    async toggleLike(idOrSlug: string, userId: string) {
        const character = await this.repo.findByIdOrSlug(idOrSlug);
        if (!character) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        if (character.visibility === "PRIVATE" && character.creatorId !== userId) throw new ApiError(403, "Cannot like a private character", "FORBIDDEN");
        if (character.status !== "PUBLISHED") throw new ApiError(400, "Only published characters can be liked", "INVALID_STATUS");
        const liked = await this.repo.isLiked(userId, character.id);
        if (liked) {
            await prisma.$transaction(async (tx) => {
                const del = await tx.like.deleteMany({ where: { userId, characterId: character.id } });
                if (del.count > 0) await tx.character.update({ where: { id: character.id }, data: { favoritesCount: { decrement: 1 } } });
            });
            try { const { cache, CacheKeys } = await import("../../infrastructure/cache/cache.js"); await cache.del(CacheKeys.character(character.slug)); await cache.delByPrefix("discovery:"); } catch {}
            return { liked: false, likesCount: await this.repo.countLikes(character.id) };
        } else {
            try {
                await prisma.$transaction(async (tx) => {
                    await tx.like.create({ data: { userId, characterId: character.id } });
                    await tx.character.update({ where: { id: character.id }, data: { favoritesCount: { increment: 1 } } });
                });
            } catch (e: any) {
                if (e.code === "P2002") {
                    return { liked: true, likesCount: await this.repo.countLikes(character.id) };
                }
                throw e;
            }
            try { const { cache, CacheKeys } = await import("../../infrastructure/cache/cache.js"); await cache.del(CacheKeys.character(character.slug)); await cache.delByPrefix("discovery:"); } catch {}
            return { liked: true, likesCount: await this.repo.countLikes(character.id) };
        }
    }
    async toggleBookmark(idOrSlug: string, userId: string) {
        const character = await this.repo.findByIdOrSlug(idOrSlug);
        if (!character) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        if (character.visibility === "PRIVATE" && character.creatorId !== userId) throw new ApiError(403, "Cannot bookmark a private character", "FORBIDDEN");
        const bookmarked = await this.repo.isBookmarked(userId, character.id);
        if (bookmarked) { await this.repo.unbookmark(userId, character.id); return { bookmarked: false }; }
        else { await this.repo.bookmark(userId, character.id); return { bookmarked: true }; }
    }
    async likeStatus(idOrSlug: string, userId: string) {
        const character = await this.repo.findByIdOrSlug(idOrSlug);
        if (!character) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        const [liked, bookmarked, likesCount] = await Promise.all([this.repo.isLiked(userId, character.id), this.repo.isBookmarked(userId, character.id), this.repo.countLikes(character.id)]);
        return { liked, bookmarked, likesCount };
    }
}
