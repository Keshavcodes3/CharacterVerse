import { logger } from "../config/pino.js";
import { queueManager } from "../infrastructure/queue/queue.js";
import { prisma } from "../infrastructure/database/db.js";
import { characterSearchService } from "../infrastructure/search/prismaCharacterSearch.js";
import { cache, CacheKeys } from "../infrastructure/cache/cache.js";

export type SearchIndexJob = { characterId: string; eventType: string };

async function handleSearchIndex(job: { data: SearchIndexJob }) {
    const { characterId, eventType } = job.data;
    if (eventType === "CharacterDeleted" || eventType === "CharacterArchived") {
        await characterSearchService.removeCharacter(characterId);
    } else {
        const char = await prisma.character.findUnique({ where: { id: characterId }, select: { status: true, visibility: true } });
        const shouldIndex = char?.status === "PUBLISHED" && char?.visibility === "PUBLIC";
        if (shouldIndex) await characterSearchService.indexCharacter(characterId);
        else await characterSearchService.removeCharacter(characterId);
    }
    await cache.delByPrefix("discovery:");
    await cache.del(CacheKeys.character(characterId));
    logger.info({ characterId, eventType }, "search index job done");
}

export function startSearchIndexingWorker() {
    queueManager.searchIndexing.process(async (job) => handleSearchIndex(job as any));
    logger.info("Search indexing worker started (queue: search-indexing)");
}

export async function enqueueSearchIndex(data: SearchIndexJob) {
    return queueManager.searchIndexing.add("index", data, { jobId: `search-${data.characterId}-${data.eventType}`, attempts: 3 });
}
