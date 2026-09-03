import { prisma } from "../infrastructure/database/db.js";
import { logger } from "../config/pino.js";
import { queueManager } from "../infrastructure/queue/queue.js";

export type TitleJob = { conversationId: string; characterId: string };

async function handleTitle(job: { data: TitleJob }) {
    const { conversationId } = job.data;
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { messages: { orderBy: { sequence: "asc" }, take: 3 } } });
    if (!conv || conv.title) return; // already titled or not found — idempotent
    const snippet = conv.messages.map((m: any) => m.content.slice(0, 200)).join("\n").slice(0, 800);
    if (snippet.length < 10) return;
    const { titlePrompt } = await import("../modules/ai/Prompts/title.prompt.js");
    const { getModel } = await import("../modules/ai/providers/index.js");
    const model = getModel("mistral");
    const msgs = await titlePrompt.formatMessages({ charName: conv.characterId, snippet });
    const res = await model.invoke(msgs as any);
    const title = (typeof res.content === "string" ? res.content : String(res.content)).trim().slice(0, 80).replace(/^["']|["']$/g, "");
    if (title.length >= 3) {
        await prisma.conversation.update({ where: { id: conversationId }, data: { title } });
        logger.info({ conversationId, title }, "title generated");
    }
}

export function startTitleWorker() {
    queueManager.getQueue("title").process(async (job) => handleTitle(job as any));
    logger.info("Title worker started");
}

export async function enqueueTitle(data: TitleJob) {
    return queueManager.getQueue<TitleJob>("title").add("title", data, { jobId: `title-${data.conversationId}`, attempts: 2 });
}
