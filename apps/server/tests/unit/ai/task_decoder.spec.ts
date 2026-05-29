import { describe, expect, it } from 'vitest';

import { decodeAiTaskOutput } from '../../../src/ai/task_decoder.js';
import type { AiResolvedTaskConfig, ModelGatewayResponse } from '../../../src/ai/types.js';

const makeBaseResponse = (overrides: Partial<ModelGatewayResponse> = {}): ModelGatewayResponse => ({
  invocation_id: 'inv-1',
  task_id: 'task-1',
  task_type: 'agent_decision',
  provider: 'test',
  model: 'test-model',
  route_id: null,
  fallback_used: false,
  attempted_models: ['test-model'],
  status: 'completed',
  finish_reason: 'stop',
  output: { mode: 'free_text', text: '' },
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  ...overrides
});

const makeTextResponse = (text: string): ModelGatewayResponse =>
  makeBaseResponse({ output: { mode: 'free_text', text } });

const makeJsonResponse = (json: Record<string, unknown>): ModelGatewayResponse =>
  makeBaseResponse({ output: { mode: 'json_object', json } });

const makeEmbeddingResponse = (embedding: number[]): ModelGatewayResponse =>
  makeBaseResponse({ output: { mode: 'embedding', embedding } });

const makeToolCallResponse = (toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>): ModelGatewayResponse =>
  makeBaseResponse({ output: { mode: 'tool_call', tool_calls: toolCalls } });

const makeTaskConfig = (overrides: Partial<AiResolvedTaskConfig> = {}): AiResolvedTaskConfig => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
  definition: {} as AiResolvedTaskConfig['definition'],
  override: null,
  output: {
    mode: 'json_object',
    schema: undefined,
    strict: false
  },
  prompt: {},
  parse: {},
  route: {},
  tools: [],
  tool_policy: { mode: 'disabled' },
  ...overrides
});

describe('decodeAiTaskOutput', () => {
  describe('embedding mode', () => {
    it('returns embedding array', () => {
      const response = makeEmbeddingResponse([0.1, 0.2, 0.3]);
      const config = makeTaskConfig({ output: { mode: 'embedding', schema: undefined, strict: false } });
      const result = decodeAiTaskOutput(response, config);
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it('throws when embedding is not array', () => {
      const response = makeTextResponse('not an embedding');
      const config = makeTaskConfig({ output: { mode: 'embedding', schema: undefined, strict: false } });
      expect(() => decodeAiTaskOutput(response, config)).toThrow(/Expected embedding output/);
    });
  });

  describe('free_text mode', () => {
    it('returns text string', () => {
      const response = makeTextResponse('hello world');
      const config = makeTaskConfig({ output: { mode: 'free_text', schema: undefined, strict: false } });
      const result = decodeAiTaskOutput<string>(response, config);
      expect(result).toBe('hello world');
    });

    it('throws when text is not string', () => {
      const response = makeJsonResponse({ text: 123 });
      const config = makeTaskConfig({ output: { mode: 'free_text', schema: undefined, strict: false } });
      expect(() => decodeAiTaskOutput(response, config)).toThrow(/Expected text output/);
    });
  });

  describe('tool_call mode', () => {
    it('returns tool_calls array', () => {
      const calls = [{ name: 'search', arguments: { q: 'test' } }];
      const response = makeToolCallResponse(calls);
      const config = makeTaskConfig({ output: { mode: 'tool_call', schema: undefined, strict: false } });
      const result = decodeAiTaskOutput(response, config);
      expect(result).toEqual(calls);
    });

    it('throws when tool_calls is not array', () => {
      const response = makeJsonResponse({ tool_calls: 'not array' });
      const config = makeTaskConfig({ output: { mode: 'tool_call', schema: undefined, strict: false } });
      expect(() => decodeAiTaskOutput(response, config)).toThrow(/Expected tool call output/);
    });
  });

  describe('json_object mode', () => {
    it('extracts json from response.output.json', () => {
      const response = makeJsonResponse({ action_type: 'respond', reasoning: 'test' });
      const config = makeTaskConfig({ output: { mode: 'json_object', schema: undefined, strict: false } });
      const result = decodeAiTaskOutput<{ action_type: string }>(response, config);
      expect(result.action_type).toBe('respond');
    });

    it('parses json from text when output.json is not object', () => {
      const response = makeTextResponse('{"action_type":"approve","reasoning":"ok"}');
      const config = makeTaskConfig({ output: { mode: 'json_object', schema: undefined, strict: false } });
      const result = decodeAiTaskOutput<{ action_type: string }>(response, config);
      expect(result.action_type).toBe('approve');
    });

    it('throws when both json and text are invalid', () => {
      const response = makeTextResponse('not json');
      const config = makeTaskConfig({ output: { mode: 'json_object', schema: undefined, strict: false } });
      expect(() => decodeAiTaskOutput(response, config)).toThrow(/Expected a structured JSON object/);
    });

    it('applies unwrap path', () => {
      const response = makeJsonResponse({ data: { nested: { action_type: 'test' } } });
      const config = makeTaskConfig({
        output: { mode: 'json_object', schema: undefined, strict: false },
        parse: { unwrap: 'data.nested' }
      });
      const result = decodeAiTaskOutput<{ action_type: string }>(response, config);
      expect(result.action_type).toBe('test');
    });

    it('applies field aliases', () => {
      const response = makeJsonResponse({ old_field: 'value', new_field: 'override' });
      const config = makeTaskConfig({
        output: { mode: 'json_object', schema: undefined, strict: false },
        parse: { field_alias: { old_field: 'aliased_field' } }
      });
      const result = decodeAiTaskOutput<{ aliased_field: string; new_field: string }>(response, config);
      expect(result.aliased_field).toBe('value');
      expect(result.new_field).toBe('override');
    });

    it('applies defaults', () => {
      const response = makeJsonResponse({ action_type: 'test' });
      const config = makeTaskConfig({
        output: { mode: 'json_object', schema: undefined, strict: false },
        parse: { defaults: { reasoning: 'default_reason' } }
      });
      const result = decodeAiTaskOutput<{ action_type: string; reasoning: string }>(response, config);
      expect(result.action_type).toBe('test');
      expect(result.reasoning).toBe('default_reason');
    });

    it('does not override existing fields with defaults', () => {
      const response = makeJsonResponse({ action_type: 'test', reasoning: 'my_reason' });
      const config = makeTaskConfig({
        output: { mode: 'json_object', schema: undefined, strict: false },
        parse: { defaults: { reasoning: 'default_reason' } }
      });
      const result = decodeAiTaskOutput<{ action_type: string; reasoning: string }>(response, config);
      expect(result.reasoning).toBe('my_reason');
    });

    it('throws when required_fields missing', () => {
      const response = makeJsonResponse({ action_type: 'test' });
      const config = makeTaskConfig({
        output: { mode: 'json_object', schema: undefined, strict: false },
        parse: { required_fields: ['reasoning', 'inference_id'] }
      });
      expect(() => decodeAiTaskOutput(response, config)).toThrow(/missing required fields/);
    });

    it('validates schema when strict mode enabled', () => {
      const response = makeJsonResponse({ action_type: 'test', priority: 'high' });
      const config = makeTaskConfig({
        output: {
          mode: 'json_object',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              action_type: { type: 'string' },
              priority: { type: 'string' }
            },
            required: ['action_type', 'priority']
          }
        }
      });
      const result = decodeAiTaskOutput<{ action_type: string; priority: string }>(response, config);
      expect(result.action_type).toBe('test');
      expect(result.priority).toBe('high');
    });

    it('throws on strict schema validation failure', () => {
      const response = makeJsonResponse({ action_type: 123 });
      const config = makeTaskConfig({
        output: {
          mode: 'json_object',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              action_type: { type: 'string' }
            },
            required: ['action_type']
          }
        }
      });
      expect(() => decodeAiTaskOutput(response, config)).toThrow(/schema validation/);
    });
  });
});
