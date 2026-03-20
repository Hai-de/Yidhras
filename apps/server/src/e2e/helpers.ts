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
}

export interface RunningServer {
  baseUrl: string;
  stop: () => Promise<void>;
  getLogs: () => string;
}

export const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) {
    throw new Error(message);
  }
};

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

  const child = spawn('npm', ['run', 'serve:e2e'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
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
