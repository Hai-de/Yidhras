import { ChildProcess, spawn } from 'node:child_process';

export interface JsonResponse {
  status: number;
  headers: Headers;
  body: unknown;
  raw: string;
}

interface StartServerOptions {
  port: number;
  startupTimeoutMs?: number;
  prepareRuntime?: boolean;
  prepareTimeoutMs?: number;
  envOverrides?: Record<string, string>;
}

export interface RunningServer {
  baseUrl: string;
  stop: () => Promise<void>;
  getLogs: () => string;
}

let runtimePreparationPromise: Promise<void> | null = null;

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const requestJson = async (
  baseUrl: string,
  endpoint: string,
  init?: RequestInit
): Promise<JsonResponse> => {
  const response = await fetch(`${baseUrl}${endpoint}`, init);
  const raw = await response.text();

  let body: unknown = raw;
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }

  return {
    status: response.status,
    headers: response.headers,
    body,
    raw
  };
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const runPackageScript = async (scriptName: string, timeoutMs: number): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const logs: string[] = [];
    const child = spawn('pnpm', ['run', scriptName], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${scriptName} timed out after ${timeoutMs}ms\n${logs.join('')}`));
    }, timeoutMs);

    child.stdout?.on('data', chunk => {
      logs.push(String(chunk));
    });

    child.stderr?.on('data', chunk => {
      logs.push(String(chunk));
    });

    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${scriptName} exited with code=${code}\n${logs.join('')}`));
    });
  });
};

const ensureRuntimePrepared = async (timeoutMs: number): Promise<void> => {
  if (!runtimePreparationPromise) {
    runtimePreparationPromise = (async () => {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await runPackageScript('prepare:runtime', timeoutMs);
          return;
        } catch (error: unknown) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (!lastError.message.includes('database is locked') || attempt === 2) {
            throw lastError;
          }
          await sleep(750);
        }
      }
      throw lastError ?? new Error('prepare:runtime failed for unknown reason');
    })().catch(error => {
      runtimePreparationPromise = null;
      throw error;
    });
  }

  await runtimePreparationPromise;
};

const stopProcess = (child: ChildProcess): Promise<void> => {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    child.once('exit', () => resolve());
    child.kill('SIGTERM');

    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }, 1500);
  });
};

export const startServer = async (options: StartServerOptions): Promise<RunningServer> => {
  const timeoutMs = options.startupTimeoutMs ?? 30000;
  const logs: string[] = [];

  if (options.prepareRuntime) {
    await ensureRuntimePrepared(options.prepareTimeoutMs ?? 120000);
  }

  const child = spawn('npm', ['run', 'serve:test-server'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...options.envOverrides,
      PORT: String(options.port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout?.on('data', chunk => {
    logs.push(String(chunk));
  });

  child.stderr?.on('data', chunk => {
    logs.push(String(chunk));
  });

  const baseUrl = `http://127.0.0.1:${options.port}`;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before ready (code=${child.exitCode})\n${logs.join('')}`);
    }

    if (child.signalCode !== null) {
      throw new Error(`server exited before ready (signal=${child.signalCode})\n${logs.join('')}`);
    }

    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.status === 200 || res.status === 503) {
        return {
          baseUrl,
          stop: () => stopProcess(child),
          getLogs: () => logs.join('')
        };
      }
    } catch {
      await sleep(250);
      continue;
    }

    await sleep(250);
  }

  await stopProcess(child);
  throw new Error(`server did not become reachable within ${timeoutMs}ms\n${logs.join('')}`);
};

export const summarizeResponse = (label: string, res: JsonResponse): string => {
  const snippet = res.raw.length > 400 ? `${res.raw.slice(0, 400)}...` : res.raw;
  return `${label} status=${res.status} body=${snippet}`;
};
