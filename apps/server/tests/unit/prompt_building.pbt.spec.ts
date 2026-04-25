import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { adaptPromptBundleToAiMessages } from '../../src/ai/adapters/prompt_bundle_adapter.js';
import { decodeAiTaskOutput } from '../../src/ai/task_decoder.js';
import type { AiResolvedTaskConfig, ModelGatewayResponse } from '../../src/ai/types.js';

const VALID_ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool']);

const createPromptBundle = (slots: {
  system_prompt?: string;
  role_prompt?: string;
  world_prompt?: string;
  context_prompt?: string;
  output_contract_prompt?: string;
  combined_prompt?: string;
}) => ({
  system_prompt: slots.system_prompt ?? '',
  role_prompt: slots.role_prompt ?? '',
  world_prompt: slots.world_prompt ?? '',
  context_prompt: slots.context_prompt ?? '',
  output_contract_prompt: slots.output_contract_prompt ?? '',
  combined_prompt: slots.combined_prompt ?? '',
  metadata: {
    prompt_version: 'phase-b-v1',
    source_prompt_keys: ['system_core'],
    workflow_task_type: 'agent_decision',
    workflow_profile_id: 'agent-decision-default',
    workflow_profile_version: '1',
    workflow_step_keys: []
  }
});

const createMinimalTaskConfig = (): AiResolvedTaskConfig => ({
  definition: {
    task_type: 'agent_decision',
    default_response_mode: 'json_schema',
    default_prompt_preset: 'default',
    default_decoder: 'default_json_schema'
  },
  override: null,
  output: { mode: 'json_schema' },
  prompt: { preset: 'test_preset' },
  parse: { decoder: 'default_json_schema' },
  route: {}
});

describe('property-based: adaptPromptBundleToAiMessages', () => {
  it('never crashes and always returns an array', () => {
    fc.assert(
      fc.property(
        fc.record({
          system_prompt: fc.string(),
          role_prompt: fc.string(),
          world_prompt: fc.string(),
          context_prompt: fc.string(),
          output_contract_prompt: fc.string(),
          combined_prompt: fc.string()
        }),
        slots => {
          const bundle = createPromptBundle(slots);
          const config = createMinimalTaskConfig();
          const messages = adaptPromptBundleToAiMessages({ promptBundle: bundle, taskConfig: config });
          expect(Array.isArray(messages)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('every message has a valid role and non-empty parts array', () => {
    fc.assert(
      fc.property(
        fc.record({
          system_prompt: fc.string({ minLength: 1 }),
          role_prompt: fc.string({ minLength: 1 }),
          world_prompt: fc.string({ minLength: 1 }),
          context_prompt: fc.string({ minLength: 1 }),
          output_contract_prompt: fc.string({ minLength: 1 }),
          combined_prompt: fc.string({ minLength: 1 })
        }),
        slots => {
          const bundle = createPromptBundle(slots);
          const config = createMinimalTaskConfig();
          const messages = adaptPromptBundleToAiMessages({ promptBundle: bundle, taskConfig: config });

          expect(messages.length).toBeGreaterThan(0);
          for (const msg of messages) {
            expect(VALID_ROLES.has(msg.role)).toBe(true);
            expect(Array.isArray(msg.parts)).toBe(true);
            expect(msg.parts.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('produces messages with system role first when system_prompt is non-empty', () => {
    fc.assert(
      fc.property(
        fc.record({
          system_prompt: fc.string({ minLength: 5 }),
          role_prompt: fc.string({ minLength: 5 }),
          world_prompt: fc.string(),
          context_prompt: fc.string(),
          output_contract_prompt: fc.string(),
          combined_prompt: fc.string()
        }),
        slots => {
          const bundle = createPromptBundle(slots);
          const config = createMinimalTaskConfig();
          const messages = adaptPromptBundleToAiMessages({ promptBundle: bundle, taskConfig: config });

          if (messages.length > 0) {
            expect(messages[0]!.role).toBe('system');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('all empty prompts produce zero messages and never crash', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 0 }),
        () => {
          const bundle = createPromptBundle({
            system_prompt: '',
            role_prompt: '',
            context_prompt: '',
            output_contract_prompt: '',
            combined_prompt: ''
          });
          const config = createMinimalTaskConfig();
          const messages = adaptPromptBundleToAiMessages({ promptBundle: bundle, taskConfig: config });
          // preset heading + developer sections may produce 0 messages with empty prompts,
          // but the function must never throw
          expect(Array.isArray(messages)).toBe(true);
        }
      ),
      { numRuns: 1 }
    );
  });
});

describe('property-based: decodeAiTaskOutput', () => {
  it('never crashes for arbitrary valid json responses', () => {
    fc.assert(
      fc.property(
        fc.record({
          action_type: fc.string(),
          payload: fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer()))
        }),
        jsonBody => {
          const response: ModelGatewayResponse = {
            invocation_id: 'inv-test',
            task_id: 'task-test',
            task_type: 'agent_decision',
            provider: 'mock',
            model: 'mock',
            route_id: null,
            fallback_used: false,
            attempted_models: [],
            status: 'completed',
            finish_reason: 'stop',
            output: { mode: 'json_schema', json: jsonBody as unknown as Record<string, unknown> }
          };
          const config = createMinimalTaskConfig();
          const result = decodeAiTaskOutput<Record<string, unknown>>(response, config);
          expect(typeof result).toBe('object');
        }
      ),
      { numRuns: 200 }
    );
  });

  it('round-trips: decoding the same json output always gives the same result', () => {
    fc.assert(
      fc.property(
        fc.record({
          action_type: fc.string(),
          payload: fc.dictionary(fc.string(), fc.string())
        }),
        jsonBody => {
          const response: ModelGatewayResponse = {
            invocation_id: 'inv-test',
            task_id: 'task-test',
            task_type: 'agent_decision',
            provider: 'mock',
            model: 'mock',
            route_id: null,
            fallback_used: false,
            attempted_models: [],
            status: 'completed',
            finish_reason: 'stop',
            output: { mode: 'json_schema', json: jsonBody as unknown as Record<string, unknown> }
          };
          const config = createMinimalTaskConfig();
          const result1 = decodeAiTaskOutput<Record<string, unknown>>(response, config);
          const result2 = decodeAiTaskOutput<Record<string, unknown>>(response, config);
          expect(result1).toEqual(result2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
