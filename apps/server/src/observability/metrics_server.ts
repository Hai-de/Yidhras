import http from 'node:http';

import { createLogger } from '../utils/logger.js';
import { getMetricsRegistry } from './metrics.js';

const logger = createLogger('metrics-server');

let server: http.Server | null = null;

export const startMetricsServer = (port: number): void => {
  if (server) {
    logger.warn('Metrics server already running');
    return;
  }

  server = http.createServer((_req, res) => {
    void (async () => {
      try {
        const metrics = await getMetricsRegistry().metrics();
        res.writeHead(200, { 'Content-Type': getMetricsRegistry().contentType });
        res.end(metrics);
      } catch {
        res.writeHead(500);
        res.end('Failed to collect metrics');
      }
    })();
  });

  server.listen(port, () => {
    logger.info(`Metrics server listening on port ${port}`);
  });

  server.on('error', (err) => {
    logger.error(`Metrics server error: ${err instanceof Error ? err.message : String(err)}`);
  });
};

export const stopMetricsServer = (): Promise<void> => {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.close(() => {
      logger.info('Metrics server stopped');
      server = null;
      resolve();
    });
  });
};
