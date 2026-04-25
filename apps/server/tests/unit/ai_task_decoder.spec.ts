import { describe, expect, it } from 'vitest';

import { decodeAiTaskOutput } from '../../src/ai/task_decoder.js';
import type { AiResolvedTaskConfig, ModelGatewayResponse } from '../../src/ai/types.js';

const createBaseResponse = (overrides?: Partial<ModelGatewayResponse>): ModelGatewayResponse => ({
  invocation_id: 'inv-001',
  task_id: 'task-agent-decision',
  task_type: 'agent_decision',
  provider: 'mock',
  model: 'mock-default',
  route_id: null,
  fallback_used: false,
  attempted_models: ['mock:mock-default'],
  status: 'completed',
  finish_reason: 'stop',
  output: {
    mode: 'json_schema',
    json: { action_type: 'post_message', payload: { content: 'hello' } }
  },
  ...overrides
});

const createBaseTaskConfig = (overrides?: Partial<AiResolvedTaskConfig>): AiResolvedTaskConfig => ({
  definition: {
    task_type: 'agent_decision',
    default_response_mode: 'json_schema',
    default_prompt_preset: 'test_preset',
    default_decoder: 'default_json_schema'
  },
  override: null,
  output: {
    mode: 'json_schema'
  },
  prompt: { preset: 'test_preset' },
  parse: { decoder: 'default_json_schema' },
  route: {},
  ...overrides
});

describe('decodeAiTaskOutput', () => {
  describe('free_text mode', () => {
    it('returns the text output', () => {
      const response = createBaseResponse({
        output: { mode: 'free_text', text: 'hello world' }
      });
      const config = createBaseTaskConfig({ output: { mode: 'free_text' } });

      const result = decodeAiTaskOutput<string>(response, config);

      expect(result).toBe('hello world');
    });

    it('throws when text is missing', () => {
      const response = createBaseResponse({
        output: { mode: 'free_text' }
      });
      const config = createBaseTaskConfig({ output: { mode: 'free_text' } });

      expect(() => decodeAiTaskOutput(response, config)).toThrow();
    });
  });

  describe('tool_call mode', () => {
    it('returns tool calls array', () => {
      const toolCalls = [{ name: 'search', arguments: { query: 'test' }, call_id: 'c1' }];
      const response = createBaseResponse({
        output: { mode: 'tool_call', tool_calls: toolCalls }
      });
      const config = createBaseTaskConfig({ output: { mode: 'tool_call' } });

      const result = decodeAiTaskOutput(response, config);

      expect(result).toEqual(toolCalls);
    });

    it('throws when tool_calls is missing', () => {
      const response = createBaseResponse({
        output: { mode: 'tool_call' }
      });
      const config = createBaseTaskConfig({ output: { mode: 'tool_call' } });

      expect(() => decodeAiTaskOutput(response, config)).toThrow();
    });
  });

  describe('embedding mode', () => {
    it('returns embedding array', () => {
      const embedding = [0.1, 0.2, 0.3];
      const response = createBaseResponse({
        output: { mode: 'embedding', embedding }
      });
      const config = createBaseTaskConfig({ output: { mode: 'embedding' } });

      const result = decodeAiTaskOutput(response, config);

      expect(result).toEqual(embedding);
    });

    it('throws when embedding is missing', () => {
      const response = createBaseResponse({
        output: { mode: 'embedding' }
      });
      const config = createBaseTaskConfig({ output: { mode: 'embedding' } });

      expect(() => decodeAiTaskOutput(response, config)).toThrow();
    });
  });

  describe('json_schema mode', () => {
    it('extracts from output.json directly', () => {
      const json = { action_type: 'narrate', payload: { text: 'once upon a time' } };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({ output: { mode: 'json_schema' } });

      const result = decodeAiTaskOutput<Record<string, unknown>>(response, config);

      expect(result).toEqual(json);
    });

    it('falls back to parsing output.text as JSON when json is null', () => {
      const json = { action_type: 'narrate' };
      const response = createBaseResponse({
        output: {
          mode: 'json_schema',
          json: null,
          text: JSON.stringify(json)
        }
      });
      const config = createBaseTaskConfig({ output: { mode: 'json_schema' } });

      const result = decodeAiTaskOutput<Record<string, unknown>>(response, config);

      expect(result).toEqual(json);
    });

    it('falls back to parsing output.text even when json is undefined', () => {
      const json = { action_type: 'narrate' };
      const response = createBaseResponse({
        output: {
          mode: 'json_schema',
          text: JSON.stringify(json)
        }
      } as Partial<ModelGatewayResponse> as ModelGatewayResponse);
      const config = createBaseTaskConfig({ output: { mode: 'json_schema' } });

      const result = decodeAiTaskOutput<Record<string, unknown>>(response, config);

      expect(result).toEqual(json);
    });

    it('throws when neither json nor valid text JSON is available', () => {
      const response = createBaseResponse({
        output: {
          mode: 'json_schema',
          json: null,
          text: 'not valid json'
        }
      });
      const config = createBaseTaskConfig({ output: { mode: 'json_schema' } });

      expect(() => decodeAiTaskOutput(response, config)).toThrow();
    });
  });

  describe('unwrap path resolution', () => {
    it('unwraps a nested path', () => {
      const json = { data: { result: { action_type: 'narrate' } } };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: { mode: 'json_schema' },
        parse: { decoder: 'default_json_schema', unwrap: 'data.result' }
      });

      const result = decodeAiTaskOutput<Record<string, unknown>>(response, config);

      expect(result).toEqual({ action_type: 'narrate' });
    });

    it('throws when unwrap resolves to a non-object', () => {
      const json = { data: { result: 'just a string' } };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: { mode: 'json_schema' },
        parse: { decoder: 'default_json_schema', unwrap: 'data.result' }
      });

      expect(() => decodeAiTaskOutput(response, config)).toThrow();
    });

    it('throws when unwrap path does not exist', () => {
      const json = { top: { inner: 'value' } };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: { mode: 'json_schema' },
        parse: { decoder: 'default_json_schema', unwrap: 'nonexistent.path' }
      });

      expect(() => decodeAiTaskOutput(response, config)).toThrow();
    });

    it('no unwrap path returns the full object', () => {
      const json = { action_type: 'narrate', nested: { deep: true } };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: { mode: 'json_schema' },
        parse: { decoder: 'default_json_schema', unwrap: undefined }
      });

      const result = decodeAiTaskOutput<Record<string, unknown>>(response, config);

      expect(result).toEqual(json);
    });
  });

  describe('field alias', () => {
    it('applies field alias when source exists and target is missing', () => {
      const json = { old_field: 'value' };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: { mode: 'json_schema' },
        parse: { decoder: 'default_json_schema', field_alias: { old_field: 'new_field' } }
      });

      const result = decodeAiTaskOutput<Record<string, unknown>>(response, config);

      expect(result.new_field).toBe('value');
      expect(result.old_field).toBe('value');
    });

    it('does not override existing target field with alias', () => {
      const json = { old_field: 'old', new_field: 'existing' };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: { mode: 'json_schema' },
        parse: { decoder: 'default_json_schema', field_alias: { old_field: 'new_field' } }
      });

      const result = decodeAiTaskOutput<Record<string, unknown>>(response, config);

      expect(result.new_field).toBe('existing');
    });

    it('handles multiple field aliases', () => {
      const json = { a: '1', b: '2' };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: { mode: 'json_schema' },
        parse: { decoder: 'default_json_schema', field_alias: { a: 'alpha', b: 'beta' } }
      });

      const result = decodeAiTaskOutput<Record<string, unknown>>(response, config);

      expect(result.alpha).toBe('1');
      expect(result.beta).toBe('2');
    });
  });

  describe('defaults', () => {
    it('merges defaults when fields are missing', () => {
      const json = { action_type: 'narrate' };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: { mode: 'json_schema' },
        parse: { decoder: 'default_json_schema', defaults: { priority: 'normal', ttl: 60 } }
      });

      const result = decodeAiTaskOutput<Record<string, unknown>>(response, config);

      expect(result.action_type).toBe('narrate');
      expect(result.priority).toBe('normal');
      expect(result.ttl).toBe(60);
    });

    it('does not override existing values with defaults', () => {
      const json = { priority: 'high' };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: { mode: 'json_schema' },
        parse: { decoder: 'default_json_schema', defaults: { priority: 'normal' } }
      });

      const result = decodeAiTaskOutput<Record<string, unknown>>(response, config);

      expect(result.priority).toBe('high');
    });
  });

  describe('required fields', () => {
    it('throws when required_fields are missing', () => {
      const json = { action_type: 'narrate' };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: { mode: 'json_schema' },
        parse: { decoder: 'default_json_schema', required_fields: ['missing_field'] }
      });

      expect(() => decodeAiTaskOutput(response, config)).toThrow();
    });

    it('passes when all required_fields are present', () => {
      const json = { action_type: 'narrate', payload: {} };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: { mode: 'json_schema' },
        parse: { decoder: 'default_json_schema', required_fields: ['action_type', 'payload'] }
      });

      expect(() => decodeAiTaskOutput(response, config)).not.toThrow();
    });

    it('schema required merges into required check', () => {
      const json = { action_type: 'narrate' };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: {
          mode: 'json_schema',
          schema: {
            type: 'object',
            required: ['payload']
          }
        },
        parse: { decoder: 'default_json_schema' }
      });

      expect(() => decodeAiTaskOutput(response, config)).toThrow();
    });
  });

  describe('strict schema validation', () => {
    it('passes when schema matches', () => {
      const json = { name: 'test', count: 42 };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: {
          mode: 'json_schema',
          strict: true,
          schema: {
            type: 'object',
            required: ['name', 'count'],
            properties: {
              name: { type: 'string' },
              count: { type: 'number' }
            }
          }
        },
        parse: { decoder: 'default_json_schema' }
      });

      expect(() => decodeAiTaskOutput(response, config)).not.toThrow();
    });

    it('throws when type does not match schema', () => {
      const json = { name: 123, count: 42 };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: {
          mode: 'json_schema',
          strict: true,
          schema: {
            type: 'object',
            required: ['name', 'count'],
            properties: {
              name: { type: 'string' },
              count: { type: 'number' }
            }
          }
        },
        parse: { decoder: 'default_json_schema' }
      });

      expect(() => decodeAiTaskOutput(response, config)).toThrow();
    });

    it('passes without validation when strict is false', () => {
      const json = { name: 123 };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: {
          mode: 'json_schema',
          strict: false,
          schema: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' }
            }
          }
        },
        parse: { decoder: 'default_json_schema' }
      });

      expect(() => decodeAiTaskOutput(response, config)).not.toThrow();
    });

    it('supports anyOf validation', () => {
      const json = { value: 42 };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: {
          mode: 'json_schema',
          strict: true,
          schema: {
            type: 'object',
            required: ['value'],
            properties: {
              value: {
                anyOf: [
                  { type: 'string' },
                  { type: 'number' }
                ]
              }
            }
          }
        },
        parse: { decoder: 'default_json_schema' }
      });

      expect(() => decodeAiTaskOutput(response, config)).not.toThrow();
    });

    it('throws on anyOf match failure', () => {
      const json = { value: true };
      const response = createBaseResponse({
        output: { mode: 'json_schema', json }
      });
      const config = createBaseTaskConfig({
        output: {
          mode: 'json_schema',
          strict: true,
          schema: {
            type: 'object',
            required: ['value'],
            properties: {
              value: {
                anyOf: [
                  { type: 'string' },
                  { type: 'number' }
                ]
              }
            }
          }
        },
        parse: { decoder: 'default_json_schema' }
      });

      expect(() => decodeAiTaskOutput(response, config)).toThrow();
    });
  });
});
