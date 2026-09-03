import { logger } from "../config/pino.js";
import { queueManager } from "../infrastructure/queue/queue.js";
import { prisma } from "../infrastructure/database/db.js";
import { MistralEmbeddingProvider } from "../infrastructure/embeddings/mistralEmbedding.provider.js";

const provider = new MistralEmbeddingProvider();

export type EmbeddingJob = { type: "memory" | "chunk"; id: string; text: string };

async function handleEmbedding(job: { data: EmbeddingJob }) {
    const { id, text, type } = job.data;
    const result = await provider.embed(text);
    if (type === "memory") {
        await prisma.memoryEmbedding.upsert({
            where: { memoryId: id },
            create: { memoryId: id, embedding: result.embedding as any, model: result.model },
            update: { embedding: result.embedding as any, model: result.model },
        });
    } else if (type === "chunk") {
        await prisma.knowledgeChunk.update({ where: { id }, data: { embedding: result.embedding as any, model: result.model } });
    }
    logger.info({ id, type, model: result.model }, "embedding generated");
}

export function startEmbeddingWorker() {
    queueManager.getQueue("embedding").process(async (job) => handleEmbedding(job as any));
    logger.info("Embedding worker started (queue: embedding)");
}

export async function enqueueEmbedding(data: EmbeddingJob) {
    return queueManager.getQueue<EmbeddingJob>("embedding").add("embed", data, { jobId: `embed-${data.type}-${data.id}`, attempts: 3 });
}
