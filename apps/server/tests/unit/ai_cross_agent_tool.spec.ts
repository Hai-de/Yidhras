import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiTaskService } from '../../src/ai/task_service.js';
import { createCrossAgentBridge, createCrossAgentToolHandler, registerCrossAgentTool } from '../../src/ai/cross_agent_tool.js';
import { createToolRegistry } from '../../src/ai/tool_executor.js';
import type { ToolExecutionContext } from '../../src/ai/tool_executor.js';
import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../src/app/context.js';
import { wrapPrismaAsRepositories } from '../helpers/mock_repos.js';

const buildMockContext = (): AppContext => {
  const prisma = { memoryBlock: { findMany: vi.fn().mockResolvedValue([]) }, relationship: { findFirst: vi.fn().mockResolvedValue(null) }, agent: { findMany: vi.fn().mockResolvedValue([]) } };
  return {
    prisma,
    repos: wrapPrismaAsRepositories(prisma as PrismaClient),
    clock: { getCurrentTick: vi.fn().mockReturnValue(42n) }
  } as unknown as AppContext;
};

describe('CrossAgentBridge', () => {
  let mockAiTaskService: AiTaskService;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    mockAiTaskService = {
      runTask: vi.fn().mockResolvedValue({
        task_id: 'task-001',
        task_type: 'agent_decision',
        invocation: {} as never,
        output: { action_type: 'idle', payload: {}, reasoning: 'test' }
      })
    };
    ctx = { context: buildMockContext(), pack_id: 'pack-1' };
  });

  it('returns success with target agent output', async () => {
    const bridge = createCrossAgentBridge(mockAiTaskService);
    const result = await bridge.queryAgent({
      target_agent_id: 'agent-b',
      task_type: 'agent_decision',
      query: { question: 'What do you see?' }
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.target_agent_id).toBe('agent-b');
    expect(result.output).toEqual({ action_type: 'idle', payload: {}, reasoning: 'test' });
  });

  it('returns error when aiTaskService throws', async () => {
    vi.mocked(mockAiTaskService.runTask).mockRejectedValue(new Error('Service unavailable'));

    const bridge = createCrossAgentBridge(mockAiTaskService);
    const result = await bridge.queryAgent({
      target_agent_id: 'agent-b',
      task_type: 'agent_decision',
      query: {}
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CROSS_AGENT_QUERY_FAILED');
    expect(result.error?.message).toBe('Service unavailable');
  });
});

describe('createCrossAgentToolHandler', () => {
  it('requires target_agent_id', async () => {
    const bridge = { queryAgent: vi.fn() };
    const handler = createCrossAgentToolHandler(bridge);

    const result = await handler.execute({}, { context: buildMockContext(), pack_id: null });
    expect(result).toEqual({
      success: false,
      error: { code: 'MISSING_TARGET_AGENT', message: 'target_agent_id is required' }
    });
    expect(bridge.queryAgent).not.toHaveBeenCalled();
  });

  it('delegates to bridge when target_agent_id is provided', async () => {
    const bridge = { queryAgent: vi.fn().mockResolvedValue({ success: true, target_agent_id: 'agent-b', output: 'ok' }) };
    const handler = createCrossAgentToolHandler(bridge);

    const result = await handler.execute(
      { target_agent_id: 'agent-b', task_type: 'agent_decision', query: { question: 'test' } },
      { context: buildMockContext(), pack_id: null }
    );

    expect(result.success).toBe(true);
    expect(bridge.queryAgent).toHaveBeenCalledWith(
      { target_agent_id: 'agent-b', task_type: 'agent_decision', query: { question: 'test' } },
      expect.anything()
    );
  });
});

describe('registerCrossAgentTool', () => {
  it('registers query_agent tool with schema and handler', async () => {
    const registry = createToolRegistry();
    const bridge = { queryAgent: vi.fn().mockResolvedValue({ success: true, target_agent_id: 'agent-b', output: 'ok' }) };

    registerCrossAgentTool(registry, bridge);
    expect(registry.has('query_agent')).toBe(true);

    const result = await registry.execute('query_agent', { target_agent_id: 'agent-b' }, {
      context: buildMockContext(),
      pack_id: null
    });

    expect(result.success).toBe(true);
    expect(bridge.queryAgent).toHaveBeenCalled();
  });
});
