import { describe, expect, it } from 'vitest';

import { decodeAiTaskOutput } from '../../src/ai/task_decoder.js';
import type { AiResolvedTaskConfig, ModelGatewayResponse } from '../../src/ai/types.js';

const createBaseResponse = (overrides?: Partial<ModelGatewayResponse>): ModelGatewayResponse => ({
  invocation_id: 'inv-001',
  task_id: 'task-001',
  task_type: 'agent_decision',
  provider: 'mock',
  model: 'mock-default',
  route_id: null,
  fallback_used: false,
  attempted_models: ['mock:mock-default'],
  status: 'completed',
  finish_reason: 'stop',
  output: { mode: 'json_object', text: '{"action_type":"post_message"}' },
  trace: undefined,
  ...overrides,
} as ModelGatewayResponse);

const createTaskConfig = (overrides?: Partial<AiResolvedTaskConfig>) => ({
  definition: {
    task_type: 'agent_decision' as const,
    default_response_mode: 'json_object' as const,
    default_prompt_preset: 'default',
    default_decoder: 'auto',
  } as AiResolvedTaskConfig['definition'],
  route: { privacy_tier: 'trusted_cloud' as const } as AiResolvedTaskConfig['route'],
  prompt: { preset: 'default' } as AiResolvedTaskConfig['prompt'],
  output: { mode: 'json_object' as const, strict: false } as AiResolvedTaskConfig['output'],
  parse: { decoder: 'auto' as const, unwrap: undefined, field_alias: undefined, defaults: undefined, required_fields: [] } as AiResolvedTaskConfig['parse'],
  override: null as AiResolvedTaskConfig['override'],
  metadata: undefined as AiResolvedTaskConfig['metadata'],
  ...overrides,
} as AiResolvedTaskConfig);

describe('decodeAiTaskOutput', () => {
  it('decodes json_object from output.text as JSON', () => {
    const response = createBaseResponse({
      output: { mode: 'json_object', text: '{"action_type":"post_message","content":"hello"}' },
    });
    const taskConfig = createTaskConfig({ output: { mode: 'json_object', strict: false } });
    const result = decodeAiTaskOutput<Record<string, unknown>>(response, taskConfig);
    expect(result).toMatchObject({ action_type: 'post_message', content: 'hello' });
  });

  it('decodes json_object from output.json when present', () => {
    const response = createBaseResponse({
      output: {
        mode: 'json_object',
        text: undefined,
        json: { action_type: 'post_message', content: 'from_json' },
      },
    });
    const taskConfig = createTaskConfig({ output: { mode: 'json_object', strict: false } });
    const result = decodeAiTaskOutput<Record<string, unknown>>(response, taskConfig);
    expect(result).toMatchObject({ action_type: 'post_message', content: 'from_json' });
  });

  it('returns embedding output for embedding mode', () => {
    const response = createBaseResponse({
      output: { mode: 'embedding', embedding: [0.1, 0.2, 0.3] },
    });
    const taskConfig = createTaskConfig({ output: { mode: 'embedding', strict: false } });
    const result = decodeAiTaskOutput<number[]>(response, taskConfig);
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it('throws on missing embedding output', () => {
    const response = createBaseResponse({
      output: { mode: 'embedding' },
    });
    const taskConfig = createTaskConfig({ output: { mode: 'embedding', strict: false } });
    expect(() => decodeAiTaskOutput(response, taskConfig)).toThrow('Expected embedding output');
  });

  it('returns free_text as string', () => {
    const response = createBaseResponse({
      output: { mode: 'free_text', text: 'Hello world' },
    });
    const taskConfig = createTaskConfig({ output: { mode: 'free_text', strict: false } });
    const result = decodeAiTaskOutput<string>(response, taskConfig);
    expect(result).toBe('Hello world');
  });

  it('throws on missing text in free_text mode', () => {
    const response = createBaseResponse({
      output: { mode: 'free_text' },
    });
    const taskConfig = createTaskConfig({ output: { mode: 'free_text', strict: false } });
    expect(() => decodeAiTaskOutput(response, taskConfig)).toThrow('Expected text output');
  });

  it('returns tool_calls for tool_call mode', () => {
    const response = createBaseResponse({
      output: {
        mode: 'tool_call',
        tool_calls: [{ name: 'search', arguments: { query: 'test' }, call_id: 'call-1' }],
      },
    });
    const taskConfig = createTaskConfig({ output: { mode: 'tool_call', strict: false } });
    const result = decodeAiTaskOutput(response, taskConfig);
    expect(Array.isArray(result)).toBe(true);
    expect((result as Array<Record<string, unknown>>)[0]?.name).toBe('search');
  });

  it('throws on missing tool_calls in tool_call mode', () => {
    const response = createBaseResponse({
      output: { mode: 'tool_call' },
    });
    const taskConfig = createTaskConfig({ output: { mode: 'tool_call', strict: false } });
    expect(() => decodeAiTaskOutput(response, taskConfig)).toThrow('Expected tool call output');
  });

  it('applies field aliases', () => {
    const response = createBaseResponse({
      output: { mode: 'json_object', text: '{"old_name":"value"}' },
    });
    const taskConfig = createTaskConfig({
      output: { mode: 'json_object', strict: false },
      parse: { decoder: 'auto', unwrap: undefined, field_alias: { old_name: 'new_name' }, defaults: undefined, required_fields: [] },
    });
    const result = decodeAiTaskOutput<Record<string, unknown>>(response, taskConfig);
    expect(result).toHaveProperty('new_name', 'value');
    expect(result).toHaveProperty('old_name', 'value');
  });

  it('applies defaults when field is missing', () => {
    const response = createBaseResponse({
      output: { mode: 'json_object', text: '{"a":1}' },
    });
    const taskConfig = createTaskConfig({
      output: { mode: 'json_object', strict: false },
      parse: { decoder: 'auto', unwrap: undefined, field_alias: undefined, defaults: { b: 2 }, required_fields: [] },
    });
    const result = decodeAiTaskOutput<Record<string, unknown>>(response, taskConfig);
    expect(result).toHaveProperty('a', 1);
    expect(result).toHaveProperty('b', 2);
  });

  it('does not override existing value with default', () => {
    const response = createBaseResponse({
      output: { mode: 'json_object', text: '{"a":99}' },
    });
    const taskConfig = createTaskConfig({
      output: { mode: 'json_object', strict: false },
      parse: { decoder: 'auto', unwrap: undefined, field_alias: undefined, defaults: { a: 1 }, required_fields: [] },
    });
    const result = decodeAiTaskOutput<Record<string, unknown>>(response, taskConfig);
    expect(result).toHaveProperty('a', 99);
  });

  it('throws on non-JSON text in json mode', () => {
    const response = createBaseResponse({
      output: { mode: 'json_object', text: 'not valid json' },
    });
    const taskConfig = createTaskConfig({ output: { mode: 'json_object', strict: false } });
    expect(() => decodeAiTaskOutput(response, taskConfig)).toThrow('Expected a structured JSON object response');
  });

  it('throws on missing required_fields', () => {
    const response = createBaseResponse({
      output: { mode: 'json_object', text: '{"x":1}' },
    });
    const taskConfig = createTaskConfig({
      output: { mode: 'json_object', strict: false },
      parse: { decoder: 'auto', unwrap: undefined, field_alias: undefined, defaults: undefined, required_fields: ['missing_field'] },
    });
    expect(() => decodeAiTaskOutput(response, taskConfig)).toThrow('missing required fields');
  });
});
