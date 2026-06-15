import { bootstrap } from './app/bootstrap.js';
import { loadConfig } from './config/index.js';
import { createLogger } from './utils/logger.js';

const main = async (): Promise<void> => {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, environment: config.nodeEnv });
  const application = await bootstrap(config, logger);

  const shutdown = (signal: NodeJS.Signals): void => {
    void application
      .stop(signal)
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error('Failed to shut down cleanly', error);
        process.exit(1);
      });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

void main().catch((error: unknown) => {
  process.stderr.write(
    `Failed to start application: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
