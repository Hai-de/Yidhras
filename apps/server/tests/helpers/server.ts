import type { RunningServer } from '../../src/e2e/helpers.js';
import {
  isRecord,
  requestJson,
  startServer,
  summarizeResponse
} from '../../src/e2e/helpers.js';

export type { JsonResponse, RunningServer } from '../../src/e2e/helpers.js';

export interface TestServerOptions {
  defaultPort: number;
  portEnvKey?: string;
  startupTimeoutMs?: number;
  prepareRuntime?: boolean;
  prepareTimeoutMs?: number;
  envOverrides?: Record<string, string>;
}

export const resolveTestPort = (defaultPort: number, envKey = 'SMOKE_PORT'): number => {
  const value = process.env[envKey];
  if (!value) {
    return defaultPort;
  }

  const port = Number.parseInt(value, 10);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`${envKey} is invalid: ${value}`);
  }

  return port;
};

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export const withTestServer = async <T>(
  options: TestServerOptions,
  run: (server: RunningServer) => Promise<T>
): Promise<T> => {
  const server = await startServer({
    port: resolveTestPort(options.defaultPort, options.portEnvKey),
    startupTimeoutMs: options.startupTimeoutMs,
    prepareRuntime: options.prepareRuntime,
    prepareTimeoutMs: options.prepareTimeoutMs,
    envOverrides: options.envOverrides
  });

  try {
    return await run(server);
  } finally {
    await server.stop();
  }
};

export { isRecord, requestJson, summarizeResponse };
