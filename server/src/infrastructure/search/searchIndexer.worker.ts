import { prisma } from "../database/db.js";
import { logger } from "../../config/pino.js";
import { characterSearchService } from "./prismaCharacterSearch.js";
import { cache, CacheKeys } from "../cache/cache.js";

/**
 * Outbox → Search Index worker.
 * Listens to CharacterCreated/Updated/Published/Archived/Deleted via OutboxEvent.
 * Idempotent — re-indexing same character is safe.
 */
const HANDLED_TYPES = new Set([
    "CharacterCreated",
    "CharacterUpdated",
    "CharacterPublished",
    "CharacterArchived",
    "CharacterDeleted",
    "CharacterSuspended",
]);

export async function handleSearchOutboxEvent(event: { eventType: string; aggregateId: string; payload: unknown }) {
    if (!HANDLED_TYPES.has(event.eventType)) return;

    const characterId = event.aggregateId;

    try {
        if (event.eventType === "CharacterDeleted" || event.eventType === "CharacterArchived") {
            await characterSearchService.removeCharacter(characterId);
            logger.info({ characterId, eventType: event.eventType }, "Search index removed");
        } else {
            // For PUBLISHED only index, otherwise ensure removed (e.g., SUSPENDED/DRAFT should not be searchable)
            const char = await prisma.character.findUnique({ where: { id: characterId }, select: { status: true, visibility: true } });
            if (!char) {
                await characterSearchService.removeCharacter(characterId);
                return;
            }
            const shouldIndex = char.status === "PUBLISHED" && char.visibility === "PUBLIC";
            if (shouldIndex) {
                await characterSearchService.indexCharacter(characterId);
                logger.info({ characterId }, "Search index upserted");
            } else {
                await characterSearchService.removeCharacter(characterId);
                logger.info({ characterId, status: char.status, visibility: char.visibility }, "Search index removed (not public/published)");
            }
        }

        // Invalidate discovery caches — explicit invalidation per spec §9
        await cache.delByPrefix("discovery:");
        await cache.delByPrefix("search:");
        await cache.del(CacheKeys.character(characterId));
    } catch (err) {
        logger.error({ err, characterId, eventType: event.eventType }, "Search indexer failed — will retry via outbox");
        throw err; // let outbox worker retry (attempts/nextAttemptAt)
    }
}

// Hook into existing outbox worker — export for registration
export const SearchIndexerHandler = {
    canHandle: (eventType: string) => HANDLED_TYPES.has(eventType),
    handle: handleSearchOutboxEvent,
};
