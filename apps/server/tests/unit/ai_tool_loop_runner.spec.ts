import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelGateway, ModelGatewayExecutionInput, ModelGatewayResponse } from '../../src/ai/gateway.js';
import { createToolLoopRunner } from '../../src/ai/tool_loop_runner.js';
import type { ToolLoopRunner } from '../../src/ai/tool_loop_runner.js';
import type { ToolExecutionContext, ToolRegistry } from '../../src/ai/tool_executor.js';
import { createToolRegistry } from '../../src/ai/tool_executor.js';
import type { AppContext } from '../../src/app/context.js';

const buildMockContext = (): AppContext => {
  return {
    prisma: { memoryBlock: { findMany: vi.fn().mockResolvedValue([]) }, relationship: { findFirst: vi.fn().mockResolvedValue(null) }, agent: { findMany: vi.fn().mockResolvedValue([]) } },
    clock: { getCurrentTick: vi.fn().mockReturnValue(42n) }
  } as unknown as AppContext;
};

const buildCompletedResponse = (overrides?: Partial<ModelGatewayResponse>): ModelGatewayResponse => ({
  invocation_id: 'inv-001',
  task_id: 'task-001',
  task_type: 'agent_decision',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  route_id: 'default.agent_decision',
  fallback_used: false,
  attempted_models: ['openai:gpt-4.1-mini'],
  status: 'completed',
  finish_reason: 'stop',
  output: {
    mode: 'json_schema',
    json: { action_type: 'idle', payload: {} }
  },
  usage: {},
  safety: { blocked: false },
  error: null,
  ...overrides
});

const buildToolCallResponse = (toolCalls: Array<{ name: string; arguments: Record<string, unknown>; call_id?: string }>): ModelGatewayResponse => {
  return buildCompletedResponse({
    finish_reason: 'tool_call',
    output: {
      mode: 'tool_call',
      tool_calls: toolCalls
    }
  });
};

const buildExecutionInput = (overrides?: Partial<ModelGatewayExecutionInput>): ModelGatewayExecutionInput => ({
  request: {
    invocation_id: 'inv-001',
    task_id: 'task-001',
    task_type: 'agent_decision',
    messages: [
      { role: 'system', parts: [{ type: 'text', text: 'You are an agent.' }] },
      { role: 'user', parts: [{ type: 'text', text: 'Decide.' }] }
    ],
    response_mode: 'json_schema',
    tools: [{ name: 'get_clock_state', description: 'Get clock', input_schema: { type: 'object', properties: {} } }],
    tool_policy: { mode: 'allowed' },
    execution: { timeout_ms: 30000, retry_limit: 0, allow_fallback: false }
  },
  task_request: {
    task_id: 'task-001',
    task_type: 'agent_decision',
    input: {},
    prompt_context: {}
  },
  task_config: {
    definition: {
      task_type: 'agent_decision',
      default_response_mode: 'json_schema',
      default_prompt_preset: 'default',
      default_decoder: 'default_json_schema',
      default_route_id: 'default.agent_decision',
      default_privacy_tier: 'trusted_cloud'
    },
    override: null,
    output: { mode: 'json_schema' },
    prompt: { preset: 'default' },
    parse: { decoder: 'default_json_schema' },
    route: { route_id: 'default.agent_decision' },
    tools: [],
    tool_policy: { mode: 'disabled' }
  },
  ...overrides
});

describe('ToolLoopRunner', () => {
  let runner: ToolLoopRunner;
  let mockGateway: ModelGateway;
  let executor: ToolRegistry;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    runner = createToolLoopRunner();
    executor = createToolRegistry();
    ctx = { context: buildMockContext(), pack_id: null };
    mockGateway = { execute: vi.fn() };
  });

  describe('non-tool-call response', () => {
    it('returns response directly when mode is not tool_call', async () => {
      const response = buildCompletedResponse();
      vi.mocked(mockGateway.execute).mockResolvedValue(response);

      const result = await runner.run(mockGateway, buildExecutionInput(), executor, ctx);

      expect(result.output.mode).toBe('json_schema');
      expect(mockGateway.execute).toHaveBeenCalledTimes(1);
    });

    it('returns failure response immediately without retry', async () => {
      const response = buildCompletedResponse({ status: 'failed', finish_reason: 'error', error: { code: 'FAIL', message: 'err', retryable: false, stage: 'provider' } });
      vi.mocked(mockGateway.execute).mockResolvedValue(response);

      const result = await runner.run(mockGateway, buildExecutionInput(), executor, ctx);

      expect(result.status).toBe('failed');
      expect(mockGateway.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('tool call loop', () => {
    it('executes a single round of tool calls and returns the final response', async () => {
      const toolCallResponse = buildToolCallResponse([{ name: 'get_clock_state', arguments: {} }]);
      const finalResponse = buildCompletedResponse();
      vi.mocked(mockGateway.execute)
        .mockResolvedValueOnce(toolCallResponse)
        .mockResolvedValueOnce(finalResponse);

      const result = await runner.run(mockGateway, buildExecutionInput(), executor, ctx);

      expect(result.output.mode).toBe('json_schema');
      expect(mockGateway.execute).toHaveBeenCalledTimes(2);
    });

    it('appends tool result messages to the conversation', async () => {
      const toolCallResponse = buildToolCallResponse([{
        name: 'get_clock_state',
        arguments: {},
        call_id: 'call-001'
      }]);
      const finalResponse = buildCompletedResponse();
      vi.mocked(mockGateway.execute)
        .mockResolvedValueOnce(toolCallResponse)
        .mockResolvedValueOnce(finalResponse);

      await runner.run(mockGateway, buildExecutionInput(), executor, ctx);

      const secondCall = vi.mocked(mockGateway.execute).mock.calls[1]![0]!;
      const messages = secondCall.request.messages;

      const toolMessages = messages.filter(m => m.role === 'tool');
      expect(toolMessages).toHaveLength(1);
      expect(toolMessages[0]!.name).toBe('get_clock_state');
      expect(toolMessages[0]!.metadata?.call_id).toBe('call-001');
    });

    it('stops at max_rounds and returns with exhaustion message', async () => {
      const toolCallResponse = buildToolCallResponse([{ name: 'get_clock_state', arguments: {} }]);
      vi.mocked(mockGateway.execute).mockResolvedValue(toolCallResponse);

      const result = await runner.run(mockGateway, buildExecutionInput(), executor, ctx, { max_rounds: 2 });

      expect(mockGateway.execute).toHaveBeenCalledTimes(2);
      expect(result.output.mode).toBe('free_text');
      expect(result.output.text).toContain('Maximum tool loop rounds reached');
    });
  });

  describe('termination tools', () => {
    it('terminates loop immediately when termination tool is called', async () => {
      const toolCallResponse = buildToolCallResponse([{
        name: 'get_clock_state',
        arguments: {},
        call_id: 'call-001'
      }]);
      vi.mocked(mockGateway.execute).mockResolvedValue(toolCallResponse);

      const result = await runner.run(
        mockGateway,
        buildExecutionInput(),
        executor,
        ctx,
        { termination_tools: ['get_clock_state'] }
      );

      expect(mockGateway.execute).toHaveBeenCalledTimes(1);
      expect(result.output.mode).toBe('free_text');
    });

    it('does not terminate when non-termination tool is called', async () => {
      const toolCallResponse = buildToolCallResponse([{ name: 'get_clock_state', arguments: {} }]);
      const finalResponse = buildCompletedResponse();
      vi.mocked(mockGateway.execute)
        .mockResolvedValueOnce(toolCallResponse)
        .mockResolvedValueOnce(finalResponse);

      const result = await runner.run(
        mockGateway,
        buildExecutionInput(),
        executor,
        ctx,
        { termination_tools: ['some_other_tool'] }
      );

      expect(mockGateway.execute).toHaveBeenCalledTimes(2);
      expect(result.output.mode).toBe('json_schema');
    });
  });

  describe('timeout', () => {
    it('returns timeout result when loop exceeds total_timeout_ms', async () => {
      const toolCallResponse = buildToolCallResponse([{ name: 'get_clock_state', arguments: {} }]);
      vi.mocked(mockGateway.execute).mockResolvedValue(toolCallResponse);

      const result = await runner.run(mockGateway, buildExecutionInput(), executor, ctx, {
        max_rounds: 100,
        total_timeout_ms: 0
      });

      expect(result.output.mode).toBe('free_text');
      expect(result.output.text).toContain('timeout');
    });
  });

  describe('tool call with empty results', () => {
    it('returns response directly when tool_calls array is empty', async () => {
      const response = buildCompletedResponse({
        finish_reason: 'tool_call',
        output: { mode: 'tool_call', tool_calls: [] }
      });
      vi.mocked(mockGateway.execute).mockResolvedValue(response);

      const result = await runner.run(mockGateway, buildExecutionInput(), executor, ctx);

      expect(result).toBe(response);
      expect(mockGateway.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('fallback_on_exhaustion', () => {
    it('returns last response when set to return_last', async () => {
      const toolCallResponse = buildToolCallResponse([{ name: 'get_clock_state', arguments: {} }]);
      vi.mocked(mockGateway.execute).mockResolvedValue(toolCallResponse);

      const result = await runner.run(mockGateway, buildExecutionInput(), executor, ctx, {
        max_rounds: 2,
        fallback_on_exhaustion: 'return_last'
      });

      expect(result.output.mode).toBe('free_text');
      expect(result.output.text).toContain('Maximum tool loop rounds reached');
    });

    it('returns error when set to error', async () => {
      const toolCallResponse = buildToolCallResponse([{ name: 'get_clock_state', arguments: {} }]);
      vi.mocked(mockGateway.execute).mockResolvedValue(toolCallResponse);

      const result = await runner.run(mockGateway, buildExecutionInput(), executor, ctx, {
        max_rounds: 2,
        fallback_on_exhaustion: 'error'
      });

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('TOOL_LOOP_EXHAUSTED');
    });
  });

  describe('trace data', () => {
    it('includes tool_loop trace on the response', async () => {
      const toolCallResponse = buildToolCallResponse([{
        name: 'get_clock_state',
        arguments: {},
        call_id: 'call-001'
      }]);
      const finalResponse = buildCompletedResponse({
        trace: {
          task_id: 'task-001',
          task_type: 'agent_decision',
          route_id: 'default.agent_decision',
          audit_level: 'standard',
          attempts: []
        }
      });
      vi.mocked(mockGateway.execute)
        .mockResolvedValueOnce(toolCallResponse)
        .mockResolvedValueOnce(finalResponse);

      const result = await runner.run(mockGateway, buildExecutionInput(), executor, ctx);

      expect(result.trace?.tool_loop).toBeDefined();
      expect(result.trace!.tool_loop!.total_rounds).toBe(2);
      expect(result.trace!.tool_loop!.rounds).toHaveLength(1);
      expect(result.trace!.tool_loop!.rounds[0]!.tool_calls).toHaveLength(1);
      expect(result.trace!.tool_loop!.rounds[0]!.tool_calls[0]!.name).toBe('get_clock_state');
      expect(result.trace!.tool_loop!.rounds[0]!.tool_calls[0]!.success).toBe(true);
    });

    it('marks exhausted=true when max_rounds reached', async () => {
      const toolCallResponse = buildToolCallResponse([{ name: 'get_clock_state', arguments: {} }]);
      vi.mocked(mockGateway.execute).mockResolvedValue(toolCallResponse);

      const result = await runner.run(mockGateway, buildExecutionInput(), executor, ctx, {
        max_rounds: 2,
        fallback_on_exhaustion: 'return_last'
      });

      expect(result.trace?.tool_loop?.exhausted).toBe(true);
    });
  });
});
