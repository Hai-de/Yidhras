import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSchedulerDecisionSidecarClient } from '../../../src/app/runtime/sidecar/scheduler_decision_sidecar_client.js';
import { createMemoryTriggerSidecarClient } from '../../../src/memory/blocks/rust_sidecar_client.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn()
}));

const createMockSpawnedProcess = () => {
  let stdoutDataHandler: ((chunk: string) => void) | undefined;

  const stdout = {
    setEncoding: vi.fn(),
    on: vi.fn((event: string, handler: (chunk: string) => void) => {
      if (event === 'data') {
        stdoutDataHandler = handler;
      }
    })
  };
  const stderr = {
    setEncoding: vi.fn(),
    on: vi.fn()
  };
  const stdin = {
    write: vi.fn((payload: string, callback?: (error?: Error | null) => void) => {
      callback?.(null);
      const request = JSON.parse(payload.trim()) as { id: string; method: string };
      if (request.method === 'scheduler.health.get') {
        stdoutDataHandler?.(`${JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocol_version: 'scheduler/v1alpha1',
            status: 'ready',
            transport: 'stdio_jsonrpc',
            uptime_ms: 1
          }
        })}\n`);
      }
      if (request.method === 'memory_trigger.protocol.handshake') {
        stdoutDataHandler?.(`${JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocol_version: 'memory_trigger/v1alpha1',
            accepted: true,
            transport: 'stdio_jsonrpc',
            engine_instance_id: 'memory-trigger-sidecar',
            supported_methods: ['memory_trigger.protocol.handshake', 'memory_trigger.health.get'],
            engine_capabilities: ['stdio_jsonrpc', 'source_evaluate']
          }
        })}\n`);
      }
      if (request.method === 'memory_trigger.health.get') {
        stdoutDataHandler?.(`${JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocol_version: 'memory_trigger/v1alpha1',
            status: 'ready',
            transport: 'stdio_jsonrpc',
            uptime_ms: 1
          }
        })}\n`);
      }
      return true;
    })
  };

  return { stdout, stderr, stdin, on: vi.fn(), kill: vi.fn() };
};

const createdRoots: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  delete process.env.WORKSPACE_ROOT;
  const { rm } = await import('node:fs/promises');
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    await rm(root, { force: true, recursive: true });
  }
});

describe('sidecar binary path resolution', () => {
  it('resolves scheduler decision sidecar relative binary path from workspace root', async () => {
    const child = createMockSpawnedProcess();
    vi.mocked(spawn).mockReturnValue(child as never);

    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'scheduler-sidecar-workspace-'));
    createdRoots.push(workspaceRoot);
    const expectedBinaryPath = path.join(
      workspaceRoot,
      'apps/server/rust/scheduler_decision_sidecar/target/debug/scheduler_decision_sidecar'
    );
    await mkdir(path.dirname(expectedBinaryPath), { recursive: true });
    await writeFile(expectedBinaryPath, '#!/bin/sh\nexit 0\n', 'utf8');
    process.env.WORKSPACE_ROOT = workspaceRoot;

    const sidecar = createSchedulerDecisionSidecarClient({
      binaryPath: 'apps/server/rust/scheduler_decision_sidecar/target/debug/scheduler_decision_sidecar',
      timeoutMs: 1200,
      autoRestart: false
    });

    await sidecar.start();

    expect(spawn).toHaveBeenCalledWith(
      expectedBinaryPath,
      [],
      expect.objectContaining({
        cwd: path.dirname(expectedBinaryPath)
      })
    );
  });

  it('resolves memory trigger sidecar relative binary path from workspace root', async () => {
    const child = createMockSpawnedProcess();
    vi.mocked(spawn).mockReturnValue(child as never);

    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'memory-sidecar-workspace-'));
    createdRoots.push(workspaceRoot);
    const expectedBinaryPath = path.join(
      workspaceRoot,
      'apps/server/rust/memory_trigger_sidecar/target/debug/memory_trigger_sidecar'
    );
    await mkdir(path.dirname(expectedBinaryPath), { recursive: true });
    await writeFile(expectedBinaryPath, '#!/bin/sh\nexit 0\n', 'utf8');
    process.env.WORKSPACE_ROOT = workspaceRoot;

    const sidecar = createMemoryTriggerSidecarClient({
      binaryPath: 'apps/server/rust/memory_trigger_sidecar/target/debug/memory_trigger_sidecar',
      timeoutMs: 1200,
      autoRestart: false
    });

    await sidecar.start();

    expect(spawn).toHaveBeenCalledWith(
      expectedBinaryPath,
      [],
      expect.objectContaining({
        cwd: path.dirname(expectedBinaryPath)
      })
    );
  });
});
