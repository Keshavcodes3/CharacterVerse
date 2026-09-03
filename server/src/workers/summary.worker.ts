import { prisma } from "../infrastructure/database/db.js";
import { logger } from "../config/pino.js";
import { queueManager } from "../infrastructure/queue/queue.js";

export type SummaryJob = { conversationId: string };

async function handleSummary(job: { data: SummaryJob }) {
    const { conversationId } = job.data;
    const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { character: { select: { name: true, description: true } }, messages: { orderBy: { sequence: "asc" }, take: 50 } },
    });
    if (!conv) return;
    const transcript = conv.messages.map((m: any) => `${m.role}: ${m.content}`).join("\n").slice(0, 6000);
    if (transcript.length < 200) return; // skip short

    // Use existing summary prompt
    const { summaryPrompt } = await import("../modules/ai/Prompts/summary.prompt.js");
    const { getModel } = await import("../modules/ai/providers/index.js");
    const model = getModel("mistral");
    const msgs = await summaryPrompt.formatMessages({
        charName: conv.character.name,
        charDescription: conv.character.description,
        conversation: transcript,
        existingSummary: conv.summary ?? "None",
    });
    const res = await model.invoke(msgs as any);
    const summary = typeof res.content === "string" ? res.content : String(res.content);
    const trimmed = summary.trim().slice(0, 2000);
    if (trimmed && trimmed !== "No summary needed — conversation too short.") {
        await prisma.conversation.update({ where: { id: conversationId }, data: { summary: trimmed } });
        logger.info({ conversationId, summaryLength: trimmed.length }, "conversation summarized");
    }
}

export function startSummaryWorker() {
    queueManager.summary.process(async (job) => handleSummary(job as any));
    logger.info("Summary worker started (queue: summary)");
}

export async function enqueueSummary(data: SummaryJob) {
    return queueManager.summary.add("summarize", data, { jobId: `summary-${data.conversationId}-${Date.now()}`, attempts: 3 });
}
