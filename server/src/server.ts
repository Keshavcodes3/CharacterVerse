import http from "node:http";
import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/pino.js";
import { outboxWorker } from "./infrastructure/outbox/outbox.worker.js";
import { startKnowledgeIngestionWorker } from "./workers/knowledgeIngestion.worker.js";
import { attachRealtimeServer } from "./realtime/ws.server.js";
import { startMemoryWorker } from "./workers/memory.worker.js";
import { startSummaryWorker } from "./workers/summary.worker.js";
import { startTitleWorker } from "./workers/title.worker.js";
import { startEmbeddingWorker } from "./workers/embedding.worker.js";
import { startAnalyticsWorker } from "./workers/analytics.worker.js";
import { startNotificationWorker } from "./workers/notification.worker.js";
import { startRecommendationWorker } from "./workers/recommendation.worker.js";
import { startSearchIndexingWorker } from "./workers/searchIndexing.worker.js";

const port = env.PORT;

const httpServer = http.createServer(app);
attachRealtimeServer(httpServer);

httpServer.listen(port, () => {
    logger.info(`CharacterVerse API + WS listening on port ${port} [${env.NODE_ENV}]`);
    if (env.NODE_ENV !== "test") {
        outboxWorker.start();
        startKnowledgeIngestionWorker();
        startMemoryWorker();
        startSummaryWorker();
        startTitleWorker();
        startEmbeddingWorker();
        startAnalyticsWorker();
        startNotificationWorker();
        startRecommendationWorker();
        startSearchIndexingWorker();
    }
});
