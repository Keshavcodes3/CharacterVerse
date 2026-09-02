import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/pino.js";

const port = env.PORT;

app.listen(port, () => {
    logger.info(`CharacterVerse API listening on port ${port} [${env.NODE_ENV}]`);
});
