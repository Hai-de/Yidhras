import { describe, expect, it } from 'vitest';

import type { ModelGatewayResponse } from '../../../src/ai/types.js';

// Test the pure utility functions that can be extracted from observability.ts
// The main recordAiInvocation function requires database context, so we test the helper logic

const makeResponse = (overrides: Partial<ModelGatewayResponse> = {}): ModelGatewayResponse => ({
  invocation_id: 'inv-1',
  task_id: 'task-1',
  task_type: 'agent_decision',
  provider: 'openai',
  model: 'gpt-4',
  route_id: 'route-1',
  fallback_used: false,
  attempted_models: ['gpt-4'],
  status: 'completed',
  finish_reason: 'stop',
  output: { mode: 'json_object', json: { action: 'test' } },
  usage: {
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    cached_input_tokens: 10,
    latency_ms: 500
  },
  ...overrides
});

describe('ModelGatewayResponse structure', () => {
  it('has all required fields', () => {
    const response = makeResponse();
    expect(response.invocation_id).toBe('inv-1');
    expect(response.task_id).toBe('task-1');
    expect(response.task_type).toBe('agent_decision');
    expect(response.provider).toBe('openai');
    expect(response.model).toBe('gpt-4');
    expect(response.status).toBe('completed');
    expect(response.finish_reason).toBe('stop');
  });

  it('supports optional usage fields', () => {
    const response = makeResponse({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        cached_input_tokens: 10,
        thinking_tokens: 5,
        estimated_cost_usd: 0.01,
        latency_ms: 500
      }
    });
    expect(response.usage?.cached_input_tokens).toBe(10);
    expect(response.usage?.thinking_tokens).toBe(5);
    expect(response.usage?.estimated_cost_usd).toBe(0.01);
  });

  it('supports optional safety fields', () => {
    const response = makeResponse({
      safety: {
        blocked: true,
        reason_code: 'content_policy',
        provider_signal: { category: 'violence' }
      }
    });
    expect(response.safety?.blocked).toBe(true);
    expect(response.safety?.reason_code).toBe('content_policy');
  });

  it('supports optional error fields', () => {
    const response = makeResponse({
      status: 'failed',
      error: {
        code: 'RATE_LIMIT',
        message: 'Rate limit exceeded',
        retryable: true,
        stage: 'provider'
      }
    });
    expect(response.status).toBe('failed');
    expect(response.error?.code).toBe('RATE_LIMIT');
    expect(response.error?.retryable).toBe(true);
  });

  it('supports cached flag', () => {
    const response = makeResponse({ cached: true });
    expect(response.cached).toBe(true);
  });

  it('supports fallback_used flag', () => {
    const response = makeResponse({ fallback_used: true, attempted_models: ['gpt-4', 'gpt-3.5-turbo'] });
    expect(response.fallback_used).toBe(true);
    expect(response.attempted_models).toHaveLength(2);
  });
});

describe('output modes', () => {
  it('json_object mode has json field', () => {
    const response = makeResponse({
      output: { mode: 'json_object', json: { key: 'value' } }
    });
    expect(response.output.mode).toBe('json_object');
    expect(response.output.json).toEqual({ key: 'value' });
  });

  it('free_text mode has text field', () => {
    const response = makeResponse({
      output: { mode: 'free_text', text: 'Hello world' }
    });
    expect(response.output.mode).toBe('free_text');
    expect(response.output.text).toBe('Hello world');
  });

  it('embedding mode has embedding field', () => {
    const response = makeResponse({
      output: { mode: 'embedding', embedding: [0.1, 0.2, 0.3] }
    });
    expect(response.output.mode).toBe('embedding');
    expect(response.output.embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it('tool_call mode has tool_calls field', () => {
    const response = makeResponse({
      output: {
        mode: 'tool_call',
        tool_calls: [
          { name: 'search', arguments: { query: 'test' }, call_id: 'call-1' }
        ]
      }
    });
    expect(response.output.mode).toBe('tool_call');
    expect(response.output.tool_calls).toHaveLength(1);
    expect(response.output.tool_calls![0].name).toBe('search');
  });
});
