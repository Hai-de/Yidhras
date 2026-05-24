import { spawn } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StdioJsonRpcTransportOptions } from '../../../src/app/runtime/sidecar/stdio_jsonrpc_transport.js';
import { StdioJsonRpcTransport } from '../../../src/app/runtime/sidecar/stdio_jsonrpc_transport.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn()
}));

type MockProcess = ReturnType<typeof createMockSpawnedProcess>;

const createMockSpawnedProcess = () => {
  let stdoutDataHandler: ((chunk: string) => void) | undefined;
  let exitHandler: (() => void) | undefined;
  let errorHandler: ((error: Error) => void) | undefined;

  const stdout = {
    setEncoding: vi.fn(),
    on: vi.fn((event: string, handler: (chunk: string) => void) => {
      if (event === 'data') stdoutDataHandler = handler;
    })
  };
  const stderr = {
    setEncoding: vi.fn(),
    on: vi.fn()
  };
  const stdin = {
    write: vi.fn((_payload: string, callback?: (error?: Error | null) => void) => {
      callback?.(null);
      return true;
    }),
    end: vi.fn(),
    once: vi.fn()
  };
  const on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    if (event === 'exit') exitHandler = handler as () => void;
    else if (event === 'error') errorHandler = handler as (error: Error) => void;
  });
  const kill = vi.fn();

  return {
    stdout,
    stderr,
    stdin,
    on,
    kill,
    triggerStdout(line: string) {
      stdoutDataHandler?.(`${line}\n`);
    },
    triggerExit() {
      exitHandler?.();
    },
    triggerError(error: Error) {
      errorHandler?.(error);
    }
  };
};


/** Respond to the most recent stdin.write call's request id */
const respondToLast = (mockProcess: MockProcess, result: unknown) => {
  const lastCall = mockProcess.stdin.write.mock.calls[
    mockProcess.stdin.write.mock.calls.length - 1
  ] as [string, ...unknown[]] | undefined;
  if (!lastCall) return;
  try {
    const parsed = JSON.parse(lastCall[0].trim()) as { id: string };
    mockProcess.triggerStdout(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result }));
  } catch { /* skip */ }
};

const baseOptions: StdioJsonRpcTransportOptions = {
  binaryPath: '',
  projectDir: 'rust/test_sidecar',
  timeoutMs: 500,
  heartbeatIntervalMs: 0,
  heartbeatMethod: 'test.health.get',
  heartbeatFailureThreshold: 2,
  errorCodePrefix: 'TEST_SIDECAR',
  logLabel: 'test-sidecar',
  autoRestart: true
};

// ──────────────────────────────────────────────────────────────────

describe('StdioJsonRpcTransport', () => {
  let mockProcess: MockProcess;
  let transport: StdioJsonRpcTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess = createMockSpawnedProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess as never);
    transport = new StdioJsonRpcTransport({ ...baseOptions });
  });

  afterEach(async () => {
    try {
      await transport.stop();
    } catch { /* noop */ }
  });

  // ── start / stop ─────────────────────────────────────────────

  describe('start and stop', () => {
    it('spawns process via cargo run by default', async () => {
      await transport.start();
      expect(spawn).toHaveBeenCalledWith(
        'cargo',
        ['run', '--quiet'],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
      );
    });

    it('stops gracefully by closing stdin then waiting for exit', async () => {
      await transport.start();

      const stopPromise = transport.stop();
      mockProcess.triggerExit();
      await stopPromise;

      expect(mockProcess.stdin.end).toHaveBeenCalled();
    });

    it('force-kills after 3 seconds if process does not exit', async () => {
      vi.useFakeTimers();
      await transport.start();

      const stopPromise = transport.stop();
      vi.advanceTimersByTime(3500);
      await stopPromise;

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
      vi.useRealTimers();
    });
  });

  // ── send / timeout ────────────────────────────────────────────

  describe('send', () => {
    it('sends JSON-RPC and parses response', async () => {
      await transport.start();

      const sendPromise = transport.send(
        'test.echo',
        { key: 'val' },
        (v) => (v as { data: string }).data
      );
      respondToLast(mockProcess, { data: 'hello' });
      const result = await sendPromise;
      expect(result).toBe('hello');
    });

    it('rejects on timeout', async () => {
      vi.useFakeTimers();
      await transport.start();

      const sendPromise = transport.send('test.slow', {}, (v) => v);
      vi.advanceTimersByTime(600);
      await expect(sendPromise).rejects.toThrow('timed out');
      vi.useRealTimers();
    });

    it('throws when transport is not started', async () => {
      await expect(transport.send('test.nope', {}, (v) => v)).rejects.toThrow('not running');
    });
  });

  // ── heartbeat (real timers, fast intervals) ───────────────────

  describe('heartbeat', () => {
    it(
      'emits unhealthy after consecutive heartbeat failures',
      async () => {
        const hbTransport = new StdioJsonRpcTransport({
          ...baseOptions,
          timeoutMs: 50,
          heartbeatIntervalMs: 100,
          heartbeatMethod: 'test.health.get',
          heartbeatFailureThreshold: 2,
          maxRestartAttempts: 1,
          autoRestart: false
        });
        const unhealthyHandler = vi.fn();
        hbTransport.on('unhealthy', unhealthyHandler);

        await hbTransport.start();

        // 等待足够多次心跳超时（间隔 100ms, timeout 50ms）
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect(unhealthyHandler).toHaveBeenCalledWith(
          expect.objectContaining({ reason: 'heartbeat_failure' })
        );

        try { await hbTransport.stop(); } catch { /* noop */ }
      },
      5000
    );

    it(
      'resets failure counter on successful heartbeat',
      async () => {
        const hbTransport = new StdioJsonRpcTransport({
          ...baseOptions,
          timeoutMs: 2000,
          heartbeatIntervalMs: 50,
          heartbeatMethod: 'test.health.get',
          heartbeatFailureThreshold: 3,
          maxRestartAttempts: 1,
          autoRestart: false
        });
        const unhealthyHandler = vi.fn();
        hbTransport.on('unhealthy', unhealthyHandler);

        await hbTransport.start();

        // 每次心跳请求到来时立即响应成功
        const interval = setInterval(() => {
          respondToLast(mockProcess, { status: 'ready' });
        }, 50);

        await new Promise((resolve) => setTimeout(resolve, 300));
        clearInterval(interval);

        expect(unhealthyHandler).not.toHaveBeenCalled();

        try { await hbTransport.stop(); } catch { /* noop */ }
      },
      5000
    );
  });

  // ── auto-restart ──────────────────────────────────────────────

  describe('auto-restart', () => {
    it('attempts to restart when process exits unexpectedly', async () => {
      const restartTransport = new StdioJsonRpcTransport({
        ...baseOptions,
        heartbeatIntervalMs: 0,
        restartBackoffBaseMs: 50
      });

      await restartTransport.start();
      expect(spawn).toHaveBeenCalledTimes(1);

      mockProcess.triggerExit();

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(spawn).toHaveBeenCalledTimes(2);

      try { await restartTransport.stop(); } catch { /* noop */ }
    });

    it('emits restarted event on successful restart', async () => {
      const restartTransport = new StdioJsonRpcTransport({
        ...baseOptions,
        heartbeatIntervalMs: 0,
        restartBackoffBaseMs: 50
      });
      const restartedHandler = vi.fn();
      restartTransport.on('restarted', restartedHandler);

      await restartTransport.start();

      const mockProcess2 = createMockSpawnedProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess2 as never);

      mockProcess.triggerExit();

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(restartedHandler).toHaveBeenCalled();

      try { await restartTransport.stop(); } catch { /* noop */ }
    });

    it('emits unhealthy after max restart attempts exhausted', async () => {
      const restartTransport = new StdioJsonRpcTransport({
        ...baseOptions,
        heartbeatIntervalMs: 0,
        maxRestartAttempts: 2,
        restartBackoffBaseMs: 50
      });
      const unhealthyHandler = vi.fn();
      restartTransport.on('unhealthy', unhealthyHandler);

      await restartTransport.start();

      // 使后续 spawn 调用抛出错误，模拟无法启动进程
      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('spawn failed');
      });

      // 触发 process error → 进入 restart 循环
      mockProcess.triggerError(new Error('simulated error'));

      // 等待所有重连尝试完成（2 次 × 退避）
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(unhealthyHandler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'start_failure' })
      );

      try { await restartTransport.stop(); } catch { /* noop */ }
    });

    it('does not restart when autoRestart is disabled', async () => {
      const noRestartTransport = new StdioJsonRpcTransport({
        ...baseOptions,
        autoRestart: false
      });
      const unhealthyHandler = vi.fn();
      noRestartTransport.on('unhealthy', unhealthyHandler);

      await noRestartTransport.start();

      mockProcess.triggerExit();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhealthyHandler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'process_exit' })
      );
      expect(spawn).toHaveBeenCalledTimes(1);

      try { await noRestartTransport.stop(); } catch { /* noop */ }
    });
  });

  // ── NDJSON framing tolerance ──────────────────────────────────

  describe('NDJSON framing tolerance', () => {
    it('skips non-JSON lines without crashing', async () => {
      await transport.start();

      mockProcess.triggerStdout('garbage line');

      const sendPromise = transport.send('test.ping', {}, (v) => v);
      respondToLast(mockProcess, { ok: true });
      const result = await sendPromise;
      expect(result).toEqual({ ok: true });
    });

    it('ignores orphan responses with no pending request id', async () => {
      await transport.start();

      mockProcess.triggerStdout(
        JSON.stringify({ jsonrpc: '2.0', id: 'orphan-id', result: { stray: true } })
      );

      const sendPromise = transport.send('test.ping', {}, (v) => v);
      respondToLast(mockProcess, { ok: true });
      const result = await sendPromise;
      expect(result).toEqual({ ok: true });
    });
  });
});
