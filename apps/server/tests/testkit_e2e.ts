import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

import { prepareIsolatedRuntime } from './helpers/runtime.js';
import { sleep } from './helpers/server.js';
import { TestKit, type TestKitOptions } from './testkit.js';

export interface E2ETestKitOptions extends TestKitOptions {
  /** Port for the test HTTP server. Default: auto-assign via 0 (ephemeral). */
  port?: number;
  /** Max ms to wait for server to respond at /api/health. Default: 30_000. */
  startupTimeoutMs?: number;
  /** Skip prepare:runtime step (identity/operator seeding). Default: false. */
  skipPrepareRuntime?: boolean;
  /** Timeout for prepare:runtime in ms. Default: 120_000. */
  prepareTimeoutMs?: number;
}

export class E2ETestKit extends TestKit {
  private serverProcess: ChildProcess | null = null;
  private _baseUrl: string | null = null;
  private _port: number | null = null;
  private serverLogs: string[] = [];

  static override async create(options: E2ETestKitOptions = {}): Promise<E2ETestKit> {
    const { port, skipPrepareRuntime, prepareTimeoutMs, ...testKitOptions } = options;

    // 1. Create base TestKit (isolated env + DB migration + Prisma + AppContext)
    const base = await TestKit.create(testKitOptions);

    // 2. Patch the prototype so the object has E2ETestKit methods.
    //    TestKit.create() returns a TestKit instance; we need it to be an E2ETestKit.
    Object.setPrototypeOf(base, E2ETestKit.prototype);

    const kit = base as E2ETestKit;
    kit._port = port ?? null;
    kit.serverProcess = null;
    kit._baseUrl = null;
    kit.serverLogs = [];

    // 3. Run prepare:runtime to seed identity/operator data (skip if requested)
    if (!skipPrepareRuntime) {
      await prepareIsolatedRuntime(kit.environment, prepareTimeoutMs ?? 120_000);
    }

    return kit;
  }

  /** Start the test HTTP server and wait for it to be ready. */
  async startServer(port?: number): Promise<void> {
    const resolvedPort = port ?? this._port ?? 0;
    if (this.serverProcess) {
      throw new Error('Server is already running');
    }

    const envVars: Record<string, string> = {
      ...this.environment.envOverrides,
      PORT: String(resolvedPort)
    };

    this.serverProcess = spawn('npm', ['run', 'serve:test-server'], {
      cwd: process.cwd(),
      env: { ...process.env, ...envVars },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.serverProcess.stdout?.on('data', chunk => {
      this.serverLogs.push(String(chunk));
    });

    this.serverProcess.stderr?.on('data', chunk => {
      this.serverLogs.push(String(chunk));
    });

    await this.waitForReady(resolvedPort);
  }

  private async waitForReady(port: number, timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    const pollUrl = `http://127.0.0.1:${port}/api/health`;

    while (Date.now() - start < timeoutMs) {
      const exitCode = this.serverProcess?.exitCode;
      if (exitCode !== null && exitCode !== undefined) {
        throw new Error(
          `Server exited with code ${String(exitCode)} before ready.\n${this.serverLogs.join('')}`
        );
      }

      try {
        const res = await fetch(pollUrl);
        if (res.status === 200 || res.status === 503) {
          this._baseUrl = `http://127.0.0.1:${port}`;
          return;
        }
      } catch {
        // Server not ready yet
      }

      await sleep(250);
    }

    await this.stopServer();
    throw new Error(
      `Server did not become reachable within ${timeoutMs}ms.\n${this.serverLogs.join('')}`
    );
  }

  get baseUrl(): string {
    if (!this._baseUrl) {
      throw new Error('Server not started. Call startServer() first.');
    }
    return this._baseUrl;
  }

  getLogs(): string {
    return this.serverLogs.join('');
  }

  async stopServer(): Promise<void> {
    if (!this.serverProcess) return;

    await new Promise<void>(resolve => {
      if (
        this.serverProcess &&
        this.serverProcess.exitCode === null &&
        this.serverProcess.signalCode === null
      ) {
        this.serverProcess.once('exit', () => resolve());
        this.serverProcess.kill('SIGTERM');

        setTimeout(() => {
          if (
            this.serverProcess &&
            this.serverProcess.exitCode === null &&
            this.serverProcess.signalCode === null
          ) {
            this.serverProcess.kill('SIGKILL');
          }
        }, 1500);
      } else {
        resolve();
      }
    });

    this.serverProcess = null;
    this._baseUrl = null;
    this.serverLogs = [];
  }

  override async [Symbol.asyncDispose](): Promise<void> {
    await this.stopServer();
    await super[Symbol.asyncDispose]();
  }
}
