import { logger } from "../config/pino.js";
import { queueManager } from "../infrastructure/queue/queue.js";
import { cache } from "../infrastructure/cache/cache.js";

export type RecommendationJob = { characterId?: string; userId?: string };

async function handleRecommendation(job: { data: RecommendationJob }) {
    // Invalidate and recompute recommendation caches
    if (job.data.userId) {
        await cache.delByPrefix(`discovery:recommended:${job.data.userId}`);
    } else {
        await cache.delByPrefix("discovery:");
    }
    logger.info({ job: job.data }, "recommendation cache refreshed");
}

export function startRecommendationWorker() {
    queueManager.recommendation.process(async (job) => handleRecommendation(job as any));
    logger.info("Recommendation worker started");
}

export async function enqueueRecommendation(data: RecommendationJob) {
    return queueManager.recommendation.add("reco", data, { jobId: `reco-${data.characterId ?? data.userId}-${Date.now()}`, attempts: 2 });
}
