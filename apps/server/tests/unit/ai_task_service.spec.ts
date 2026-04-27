import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiTaskOverride, AiTaskRequest, AiTaskService, ModelGateway, ModelGatewayExecutionInput, ModelGatewayResponse } from '../../src/ai/types.js';
import { createAiTaskService } from '../../src/ai/task_service.js';

const buildCompletedResponse = (input: ModelGatewayExecutionInput): ModelGatewayResponse => ({
  invocation_id: input.request.invocation_id,
  task_id: input.request.task_id,
  task_type: input.request.task_type,
  provider: 'openai',
  model: 'gpt-4.1-mini',
  route_id: input.request.route_id ?? null,
  fallback_used: false,
  attempted_models: ['openai:gpt-4.1-mini'],
  status: 'completed',
  finish_reason: 'stop',
  output: {
    mode: input.request.response_mode,
    json: { action_type: 'idle', payload: {} }
  },
  usage: {
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    latency_ms: 200
  },
  safety: { blocked: false },
  error: null
});

const buildBaseRequest = (overrides?: Partial<AiTaskRequest>): AiTaskRequest => ({
  task_id: 'task-001',
  task_type: 'agent_decision',
  input: {},
  prompt_context: {
    messages: [
      { role: 'system', parts: [{ type: 'text', text: 'You are an agent.' }] },
      { role: 'user', parts: [{ type: 'text', text: 'Decide.' }] }
    ]
  },
  ...overrides
});

describe('AiTaskService', () => {
  let capturedRequest: ModelGatewayExecutionInput | null = null;
  let service: AiTaskService;

  const createCapturingGateway = (): ModelGateway => ({
    async execute(input) {
      capturedRequest = input;
      return buildCompletedResponse(input);
    }
  });

  beforeEach(() => {
    capturedRequest = null;
    service = createAiTaskService({ gateway: createCapturingGateway() });
  });

  describe('tools passthrough', () => {
    it('passes tools from AiTaskRequest to ModelGatewayRequest', async () => {
      const tools = [
        { name: 'get_clock_state', description: 'Get current clock state', input_schema: { type: 'object', properties: {} } }
      ];

      await service.runTask(buildBaseRequest({ tools }));

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.request.tools).toEqual(tools);
    });

    it('defaults tools to empty array when not provided', async () => {
      await service.runTask(buildBaseRequest());

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.request.tools).toEqual([]);
    });

    it('defaults tools to empty array when undefined is explicitly passed', async () => {
      await service.runTask(buildBaseRequest({ tools: undefined }));

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.request.tools).toEqual([]);
    });
  });

  describe('tool_policy passthrough', () => {
    it('passes tool_policy from AiTaskRequest to ModelGatewayRequest', async () => {
      await service.runTask(buildBaseRequest({
        tool_policy: { mode: 'allowed', allowed_tool_names: ['get_clock_state'] }
      }));

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.request.tool_policy).toEqual({
        mode: 'allowed',
        allowed_tool_names: ['get_clock_state']
      });
    });

    it('defaults tool_policy to disabled when not provided', async () => {
      await service.runTask(buildBaseRequest());

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.request.tool_policy).toEqual({ mode: 'disabled' });
    });

    it('passes tool_policy mode required correctly', async () => {
      await service.runTask(buildBaseRequest({ tool_policy: { mode: 'required' } }));

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.request.tool_policy).toEqual({ mode: 'required' });
    });
  });

  describe('combined tools and tool_policy', () => {
    it('passes both tools and tool_policy simultaneously', async () => {
      const tools = [
        { name: 'get_entity', description: 'Get entity by id', input_schema: { type: 'object', properties: { entity_id: { type: 'string' } }, required: ['entity_id'] } }
      ];

      await service.runTask(buildBaseRequest({
        tools,
        tool_policy: { mode: 'allowed', max_tool_calls: 5 }
      }));

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.request.tools).toEqual(tools);
      expect(capturedRequest!.request.tool_policy).toEqual({ mode: 'allowed', max_tool_calls: 5 });
    });
  });

  describe('config-driven tool selection', () => {
    it('resolves tools from registry when inlineOverride sets tools', async () => {
      const override: AiTaskOverride = {
        tools: ['sys.get_clock_state'],
        tool_policy: { mode: 'allowed' }
      };

      await service.runTask(buildBaseRequest(), { inlineOverride: override });

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.request.tools).toHaveLength(1);
      expect(capturedRequest!.request.tools![0]!.name).toBe('get_clock_state');
      expect(capturedRequest!.request.tools![0]!.description).toBe('Get the current simulation clock state including tick and formatted times');
      expect(capturedRequest!.request.tool_policy).toEqual({ mode: 'allowed' });
    });

    it('ignores request tools when config has tools', async () => {
      const override: AiTaskOverride = {
        tools: ['sys.get_clock_state'],
        tool_policy: { mode: 'required' }
      };

      const requestTools = [
        { name: 'should_be_ignored', description: 'x', input_schema: { type: 'object', properties: {} } }
      ];

      await service.runTask(
        buildBaseRequest({ tools: requestTools, tool_policy: { mode: 'allowed' } }),
        { inlineOverride: override }
      );

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.request.tools).toHaveLength(1);
      expect(capturedRequest!.request.tools![0]!.name).toBe('get_clock_state');
      expect(capturedRequest!.request.tool_policy).toEqual({ mode: 'required' });
    });

    it('falls back to request tools when config tools is empty', async () => {
      const requestTools = [
        { name: 'custom_tool', description: 'Custom', input_schema: { type: 'object', properties: {} } }
      ];

      await service.runTask(
        buildBaseRequest({ tools: requestTools, tool_policy: { mode: 'allowed' } })
      );

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.request.tools).toEqual(requestTools);
      expect(capturedRequest!.request.tool_policy).toEqual({ mode: 'allowed' });
    });

    it('resolves multiple tools from registry', async () => {
      const override: AiTaskOverride = {
        tools: ['sys.get_clock_state', 'sys.get_entity'],
        tool_policy: { mode: 'allowed', max_tool_calls: 2 }
      };

      await service.runTask(buildBaseRequest(), { inlineOverride: override });

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.request.tools).toHaveLength(2);
      expect(capturedRequest!.request.tools![0]!.name).toBe('get_clock_state');
      expect(capturedRequest!.request.tools![1]!.name).toBe('get_entity');
    });

    it('resolves empty tools when config references nonexistent tool_ids', async () => {
      const override: AiTaskOverride = {
        tools: ['sys.nonexistent'],
        tool_policy: { mode: 'allowed' }
      };

      await service.runTask(buildBaseRequest(), { inlineOverride: override });

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.request.tools).toEqual([]);
    });
  });
});
