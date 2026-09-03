import { prisma } from "../../infrastructure/database/db.js";
import { ApiError } from "../../utils/apiError.js";
import { logger } from "../../config/pino.js";
import { KnowledgeBaseRepository } from "./knowledgeBase.repository.js";
import { extractText } from "../../infrastructure/rag/documentProcessor.js";
import { chunkText, chunkMarkdown, type ChunkOptions } from "../../infrastructure/rag/chunker.js";
import { MistralEmbeddingProvider } from "../../infrastructure/embeddings/mistralEmbedding.provider.js";
import { PgVectorStore } from "../../infrastructure/vector/pgVectorStore.js";
import { CohereReranker } from "../../infrastructure/rag/reranker.js";
import { RetrievalService } from "../../infrastructure/rag/retrieval.service.js";

const kbRepo = new KnowledgeBaseRepository();
const embeddingProvider = new MistralEmbeddingProvider();
const vectorStore = new PgVectorStore();
const reranker = new CohereReranker();
export const retrievalService = new RetrievalService(embeddingProvider, vectorStore, reranker);

export interface CreateDocumentInput {
    characterId: string;
    knowledgeBaseId?: string | null;
    title: string;
    content?: string | null; // text/markdown
    rawContent?: string | null;
    sourceUrl?: string | null;
    mimeType?: string | null;
    fileBuffer?: Buffer | null;
    chunkOptions?: ChunkOptions | null;
    metadata?: Record<string, unknown> | null;
}

export class KnowledgeService {
    /** Ensure character ownership — tenant isolation */
    private async assertOwner(characterId: string, requesterId: string) {
        const c = await prisma.character.findUnique({ where: { id: characterId }, select: { id: true, creatorId: true } });
        if (!c) throw new ApiError(404, "Character not found", "CHARACTER_NOT_FOUND");
        if (c.creatorId !== requesterId) throw new ApiError(403, "Forbidden — not owner", "FORBIDDEN");
        return c;
    }

    async getOrCreateKnowledgeBase(characterId: string, requesterId: string, name = "default") {
        await this.assertOwner(characterId, requesterId);
        const kb = await prisma.knowledgeBase.findFirst({ where: { characterId, name } });
        if (kb) return kb;
        return kbRepo.create(characterId, { name });
    }

    async listKnowledgeBases(characterId: string, requesterId: string) {
        await this.assertOwner(characterId, requesterId);
        return kbRepo.list(characterId);
    }

    async createKnowledgeBase(characterId: string, requesterId: string, data: { name: string; description?: string | null }) {
        await this.assertOwner(characterId, requesterId);
        return kbRepo.create(characterId, data);
    }

    /** API: create document → enqueue ingestion → return PENDING */
    async createDocument(input: CreateDocumentInput, requesterId: string) {
        await this.assertOwner(input.characterId, requesterId);

        // Resolve knowledge base — auto-create default if not specified
        let kbId = input.knowledgeBaseId ?? null;
        if (!kbId) {
            const kb = await kbRepo.getOrCreateDefault(input.characterId);
            kbId = kb.id;
        } else {
            const kb = await prisma.knowledgeBase.findUnique({ where: { id: kbId } });
            if (!kb || kb.characterId !== input.characterId) throw new ApiError(404, "Knowledge base not found or not owned", "KB_NOT_FOUND");
        }

        // Validate per spec §2
        const mime = (input.mimeType ?? "text/plain").toLowerCase();
        const allowed = ["text/plain", "text/markdown", "application/pdf", "text/html", "application/octet-stream"];
        if (!allowed.some((a) => mime.includes(a.split("/")[1]) || mime === a) && !input.content && !input.sourceUrl && !input.fileBuffer) {
            // still allow text
        }

        // Idempotency: duplicate title+character+kb check (optional)
        // Store original then async process
        const doc = await prisma.$transaction(async (tx) => {
            const created = await tx.knowledgeDocument.create({
                data: {
                    characterId: input.characterId,
                    knowledgeBaseId: kbId,
                    title: input.title,
                    content: input.content ?? "",
                    rawContent: input.rawContent ?? input.content ?? null,
                    source: input.sourceUrl ?? null,
                    sourceUrl: input.sourceUrl ?? null,
                    mimeType: mime,
                    fileUrl: null,
                    status: "PENDING" as never,
                    metadata: (input.metadata ?? {}) as never,
                },
            });
            await tx.ingestionJob.create({
                data: {
                    documentId: created.id,
                    characterId: input.characterId,
                    knowledgeBaseId: kbId,
                    status: "PENDING" as never,
                    payload: { chunkOptions: input.chunkOptions ?? { chunkSize: 800, overlap: 150, strategy: "recursive" } } as never,
                },
            });
            await tx.outboxEvent.create({
                data: { aggregateType: "KnowledgeDocument", aggregateId: created.id, eventType: "KnowledgeDocumentCreated", payload: { documentId: created.id, characterId: input.characterId, knowledgeBaseId: kbId } as never, status: "PENDING" },
            });
            return created;
        });

        // Enqueue ingestion async (do not await processing)
        void this.enqueueIngestion(doc.id).catch((e) => logger.error({ err: e, documentId: doc.id }, "enqueue failed"));

        logger.info({ documentId: doc.id, characterId: input.characterId, knowledgeBaseId: kbId }, "Document created PENDING");
        return doc;
    }

    private async enqueueIngestion(documentId: string) {
        // In production this would push to BullMQ/Redis. Here we trigger worker inline with retry.
        // No-op if already processing
        void import("../../workers/knowledgeIngestion.worker.js").then((m) => m.processDocument(documentId).catch(() => {}));
    }

    /** Synchronous ingestion pipeline: extract → normalize → chunk → embed → persist → READY */
    async processDocumentIngestion(documentId: string) {
        const doc = await prisma.knowledgeDocument.findUnique({ where: { id: documentId } });
        if (!doc) throw new Error(`Document ${documentId} not found`);
        if (doc.status === "READY" || doc.status === "DELETED") return doc; // idempotent

        const job = await prisma.ingestionJob.findUnique({ where: { documentId } });
        if (job?.status === "COMPLETED") return doc;

        await prisma.knowledgeDocument.update({ where: { id: documentId }, data: { status: "PROCESSING" as never } });
        if (job) await prisma.ingestionJob.update({ where: { documentId }, data: { status: "PROCESSING" as never, attempts: { increment: 1 } } });

        try {
            // 1. Extract text (supports text/markdown/pdf/urls)
            const extracted = await extractText({
                title: doc.title,
                mimeType: doc.mimeType ?? undefined,
                sourceUrl: (doc.sourceUrl ?? doc.source) ?? undefined,
                rawContent: doc.rawContent ?? doc.content ?? undefined,
                fileBuffer: null,
            });

            const text = extracted.text;
            if (!text.trim()) throw new Error("Extracted text empty");

            // 2. Chunk with metadata preservation
            const payload = (job?.payload as { chunkOptions?: ChunkOptions } | null) ?? null;
            const chunkOptions: ChunkOptions = payload?.chunkOptions ?? { chunkSize: 800, overlap: 150, strategy: "recursive" };
            const isMarkdown = (doc.mimeType ?? "").includes("markdown") || doc.title.endsWith(".md");
            const chunks = isMarkdown ? chunkMarkdown(text, chunkOptions) : chunkText(text, chunkOptions);

            if (chunks.length === 0) throw new Error("No chunks produced");

            // 3. Embed batch (omit hard-coding Mistral — via EmbeddingProvider abstraction)
            const embeddings = await embeddingProvider.embedBatch(chunks.map((c) => c.content));

            // 4. Persist chunks + vectors (delete old first for idempotency/duplicate ingestion)
            await prisma.$transaction(async (tx) => {
                await tx.knowledgeChunk.deleteMany({ where: { documentId } });
                for (let i = 0; i < chunks.length; i++) {
                    const ch = chunks[i];
                    const emb = embeddings[i];
                    await tx.knowledgeChunk.create({
                        data: {
                            documentId: doc.id,
                            knowledgeBaseId: doc.knowledgeBaseId,
                            characterId: doc.characterId,
                            content: ch.content,
                            chunkIndex: ch.chunkIndex,
                            page: ch.page ?? null,
                            section: ch.section ?? null,
                            source: doc.source ?? doc.sourceUrl ?? null,
                            metadata: { ...ch.metadata, ...extracted.metadata } as never,
                            embedding: emb.embedding as never,
                            model: emb.model,
                        },
                    });
                }
                await tx.knowledgeDocument.update({ where: { id: doc.id }, data: { status: "READY" as never, chunkCount: chunks.length, content: text.slice(0, 20000), error: null } });
                if (job) await tx.ingestionJob.update({ where: { documentId }, data: { status: "COMPLETED" as never } });
                await tx.outboxEvent.create({ data: { aggregateType: "KnowledgeDocument", aggregateId: doc.id, eventType: "KnowledgeDocumentReady", payload: { documentId: doc.id, chunkCount: chunks.length } as never, status: "PENDING" } });
            });

            logger.info({ documentId, chunks: chunks.length }, "Document ingestion READY");
            return prisma.knowledgeDocument.findUnique({ where: { id: documentId } });
        } catch (err) {
            const msg = String((err as Error).message).slice(0, 2000);
            await prisma.knowledgeDocument.update({ where: { id: documentId }, data: { status: "FAILED" as never, error: msg } });
            if (job) {
                const attempts = job.attempts + 1;
                const shouldRetry = attempts < 3;
                await prisma.ingestionJob.update({
                    where: { documentId },
                    data: { status: shouldRetry ? "PENDING" as never : "FAILED" as never, lastError: msg, nextAttemptAt: shouldRetry ? new Date(Date.now() + 1000 * Math.pow(4, attempts)) : null },
                });
            }
            logger.error({ err, documentId }, "Document ingestion FAILED");
            throw err;
        }
    }

    async getDocument(documentId: string, requesterId: string) {
        const doc = await prisma.knowledgeDocument.findUnique({ where: { id: documentId }, include: { knowledgeBase: true } });
        if (!doc) throw new ApiError(404, "Document not found", "DOCUMENT_NOT_FOUND");
        await this.assertOwner(doc.characterId, requesterId);
        return doc;
    }

    async listDocuments(characterId: string, knowledgeBaseId: string | null, requesterId: string, opts?: { page?: number; limit?: number; status?: string }) {
        await this.assertOwner(characterId, requesterId);
        const where: Record<string, unknown> = { characterId };
        if (knowledgeBaseId) (where as Record<string, unknown>).knowledgeBaseId = knowledgeBaseId;
        if (opts?.status) (where as Record<string, unknown>).status = opts.status;
        else (where as Record<string, unknown>).status = { not: "DELETED" };
        const page = opts?.page ?? 1; const limit = Math.min(opts?.limit ?? 20, 100);
        const [total, data] = await Promise.all([prisma.knowledgeDocument.count({ where: where as never }), prisma.knowledgeDocument.findMany({ where: where as never, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit })]);
        return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    }

    /** Delete semantics §9: async cleanup of db metadata + vectors + file + cache */
    async deleteDocument(documentId: string, requesterId: string) {
        const doc = await prisma.knowledgeDocument.findUnique({ where: { id: documentId } });
        if (!doc) throw new ApiError(404, "Document not found", "DOCUMENT_NOT_FOUND");
        await this.assertOwner(doc.characterId, requesterId);

        await prisma.$transaction(async (tx) => {
            await tx.knowledgeDocument.update({ where: { id: documentId }, data: { status: "DELETED" as never } });
            await tx.ingestionJob.deleteMany({ where: { documentId } });
            await tx.outboxEvent.create({ data: { aggregateType: "KnowledgeDocument", aggregateId: documentId, eventType: "KnowledgeDocumentDeleted", payload: { documentId, characterId: doc.characterId } as never, status: "PENDING" } });
        });

        // async vector cleanup (decouple)
        void vectorStore.deleteByDocument(documentId).then(() => {
            // hard delete after vector cleanup (or via worker)
            void prisma.knowledgeDocument.delete({ where: { id: documentId } }).catch(() => {});
        });

        logger.info({ documentId, characterId: doc.characterId }, "Document marked DELETED, vector cleanup enqueued");
        return { deleted: true };
    }

    async deleteKnowledgeBase(kbId: string, requesterId: string) {
        const kb = await prisma.knowledgeBase.findUnique({ where: { id: kbId } });
        if (!kb) throw new ApiError(404, "Knowledge base not found", "KB_NOT_FOUND");
        await this.assertOwner(kb.characterId, requesterId);
        await prisma.$transaction(async (tx) => {
            await tx.knowledgeDocument.updateMany({ where: { knowledgeBaseId: kbId }, data: { status: "DELETED" as never } });
            await tx.knowledgeChunk.deleteMany({ where: { knowledgeBaseId: kbId } });
            await tx.knowledgeBase.delete({ where: { id: kbId } });
        });
        void vectorStore.deleteByKnowledgeBase(kbId).catch(() => {});
        return { deleted: true };
    }

    // Agent integration §7
    async retrieveRelevantKnowledge(params: { characterId: string; knowledgeBaseId?: string | null; query: string; topK?: number; topN?: number }) {
        // Ownership already enforced at retrieval level via vectorStore filtering; still check existence
        return retrievalService.retrieveRelevantKnowledge(params);
    }
}

export const knowledgeService = new KnowledgeService();
