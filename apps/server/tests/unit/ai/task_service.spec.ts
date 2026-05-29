import { describe, expect, it } from 'vitest';

import { buildInlineOverrideFromRequest, buildGatewayRequest } from '../../../src/ai/task_service.js';
import type { AiTaskRequest, AiResolvedTaskConfig, AiMessage } from '../../../src/ai/types.js';

const makeTaskRequest = (overrides?: Partial<AiTaskRequest>): AiTaskRequest => ({
  task_id: 'task-1',
  task_type: 'agent_decision',
  input: { message: 'hello' },
  prompt_context: {
    prompt_bundle_v2: null,
    current_agent_id: 'agent-1'
  },
  output_contract: { mode: 'free_text', json_schema: undefined },
  route_hints: {},
  tools: [],
  tool_policy: { mode: 'disabled' },
  metadata: {},
  ...overrides
} as AiTaskRequest);

const makeTaskConfig = (overrides?: Partial<AiResolvedTaskConfig>): AiResolvedTaskConfig => ({
  output: { mode: 'free_text' },
  route: { route_id: 'default', provider: 'openai', model: 'gpt-4', privacy_tier: 'trusted_cloud' },
  tools: [],
  tool_policy: { mode: 'disabled' as const },
  prompt: { preset: 'default' },
  parse: { decoder: 'none' },
  metadata: undefined,
  ...overrides
} as AiResolvedTaskConfig);

const makeMessages = (): AiMessage[] => [
  { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
];

describe('task_service', () => {
  describe('buildInlineOverrideFromRequest', () => {
    it('returns null when no output_contract overrides', () => {
      const request = makeTaskRequest({ output_contract: undefined });
      expect(buildInlineOverrideFromRequest(request)).toBeNull();
    });

    it('returns null when output_contract has no mode or json_schema', () => {
      const request = makeTaskRequest({ output_contract: {} as any });
      const result = buildInlineOverrideFromRequest(request);
      expect(result).toBeNull();
    });

    it('returns override when mode is specified', () => {
      const request = makeTaskRequest({
        output_contract: { mode: 'json_object', json_schema: undefined }
      });
      const result = buildInlineOverrideFromRequest(request);
      expect(result).not.toBeNull();
      expect(result!.output!.mode).toBe('json_object');
    });

    it('returns override when json_schema is specified', () => {
      const schema = { type: 'object', properties: { name: { type: 'string' } } };
      const request = makeTaskRequest({
        output_contract: { mode: 'free_text' as const, json_schema: schema }
      });
      const result = buildInlineOverrideFromRequest(request);
      expect(result).not.toBeNull();
      expect(result!.output!.schema).toEqual(schema);
    });

    it('returns override with both mode and schema', () => {
      const schema = { type: 'object' as const };
      const request = makeTaskRequest({
        output_contract: { mode: 'json_schema', json_schema: schema }
      });
      const result = buildInlineOverrideFromRequest(request);
      expect(result).not.toBeNull();
      expect(result!.output!.mode).toBe('json_schema');
      expect(result!.output!.schema).toEqual(schema);
    });
  });

  describe('buildGatewayRequest', () => {
    const messages = makeMessages();

    it('builds a valid gateway request', () => {
      const request = makeTaskRequest();
      const config = makeTaskConfig();
      const result = buildGatewayRequest(request, messages, config);

      expect(result.task_id).toBe('task-1');
      expect(result.task_type).toBe('agent_decision');
      expect(result.messages).toEqual(messages);
      expect(result.response_mode).toBe('free_text');
      expect(result.invocation_id).toBeDefined();
    });

    it('uses task config route hints', () => {
      const request = makeTaskRequest();
      const config = makeTaskConfig({
        route: { route_id: 'r1', provider: 'anthropic', model: 'claude-3', privacy_tier: 'trusted_cloud' }
      });
      const result = buildGatewayRequest(request, messages, config);

      expect(result.provider_hint).toBe('anthropic');
      expect(result.model_hint).toBe('claude-3');
      expect(result.route_id).toBe('r1');
    });

    it('falls back to request route hints when config has no provider', () => {
      const request = makeTaskRequest({
        route_hints: { provider: 'openai', model: 'gpt-3.5', route_id: 'fallback' }
      });
      const config = makeTaskConfig({
        route: { route_id: undefined, provider: undefined, model: undefined }
      });
      const result = buildGatewayRequest(request, messages, config);

      expect(result.provider_hint).toBe('openai');
      expect(result.model_hint).toBe('gpt-3.5');
      expect(result.route_id).toBe('fallback');
    });

    it('builds structured_output when mode is json_schema', () => {
      const schema = { type: 'object', properties: { name: { type: 'string' } } };
      const config = makeTaskConfig({
        output: { mode: 'json_schema', schema, strict: true }
      });
      const result = buildGatewayRequest(makeTaskRequest(), messages, config);

      expect(result.structured_output).not.toBeNull();
      expect(result.structured_output?.schema_name).toBe('agent_decision_schema');
      expect(result.structured_output?.json_schema).toEqual(schema);
      expect(result.structured_output?.strict).toBe(true);
    });

    it('sets structured_output to null when mode is free_text', () => {
      const config = makeTaskConfig({ output: { mode: 'free_text' } });
      const result = buildGatewayRequest(makeTaskRequest(), messages, config);
      expect(result.structured_output).toBeNull();
    });

    it('includes execution config', () => {
      const result = buildGatewayRequest(makeTaskRequest(), messages, makeTaskConfig());
      expect(result.execution!.timeout_ms).toBe(30000);
      expect(result.execution!.retry_limit).toBe(0);
      expect(result.execution!.allow_fallback).toBe(true);
    });

    it('includes governance config', () => {
      const config = makeTaskConfig({
        route: { route_id: 'r1', provider: 'p', model: 'm', privacy_tier: 'local_only' as const }
      });
      const result = buildGatewayRequest(makeTaskRequest(), messages, config);
      expect(result.governance!.privacy_tier).toBe('local_only');
      expect(result.governance!.audit_level).toBe('standard');
    });

    it('includes metadata from request', () => {
      const request = makeTaskRequest({
        metadata: {
          inference_id: 'inf-123',
          prompt_version: 'v1',
          source_prompt_keys: [],
          workflow_task_type: 'custom_workflow',
          workflow_profile_id: 'profile-1',
          workflow_profile_version: 'v2',
          workflow_step_keys: ['step-1', 'step-2']
        }
      });
      const result = buildGatewayRequest(request, messages, makeTaskConfig());

      expect(result.execution!.idempotency_key).toBe('inf-123');
      expect(result.metadata!.inference_id).toBe('inf-123');
      expect(result.metadata!.workflow_task_type).toBe('custom_workflow');
      expect(result.metadata!.workflow_profile_id).toBe('profile-1');
      expect(result.metadata!.workflow_profile_version).toBe('v2');
      expect(result.metadata!.workflow_step_keys).toEqual(['step-1', 'step-2']);
    });

    it('uses task_type when workflow_task_type is not set', () => {
      const request = makeTaskRequest({ task_type: 'agent_decision' });
      const result = buildGatewayRequest(request, messages, makeTaskConfig());
      expect(result.metadata!.workflow_task_type).toBe('agent_decision');
    });
  });
});
