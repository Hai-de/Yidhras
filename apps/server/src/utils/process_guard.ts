import type { Logger } from './logger.js';

/**
 * Install global process safety nets.
 *
 * - uncaughtException: fatal — logs the error and exits after a flush delay.
 * - unhandledRejection: non-fatal — logs the rejection but keeps the process alive.
 *   The rejection may originate from a fire-and-forget promise that is not
 *   critical to continued operation, but must be visible for debugging.
 *
 * Must be called early in the boot sequence, after logger configuration is set.
 */
export const installProcessGuards = (logger: Logger): void => {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception — process will exit', {
      error,
      code: 'PROCESS_UNCAUGHT_EXCEPTION'
    });
    // Allow the logger to flush before hard exit.
    setTimeout(() => {
      process.exitCode = 1;
      process.exit(1);
    }, 1000);
  });

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('Unhandled promise rejection', {
      error,
      code: 'PROCESS_UNHANDLED_REJECTION'
    });
  });
};
