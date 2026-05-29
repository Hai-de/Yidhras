import { describe, expect, it } from 'vitest';

import { getAiTaskDefinition,resolveAiTaskConfig } from '../../../src/ai/task_definitions.js';

describe('getAiTaskDefinition', () => {
  it('returns definition for agent_decision', () => {
    const def = getAiTaskDefinition('agent_decision');
    expect(def.task_type).toBe('agent_decision');
    expect(def.default_response_mode).toBe('json_schema');
    expect(def.default_schema).toBeDefined();
    expect(def.default_schema?.required).toContain('action_type');
  });

  it('returns definition for embedding', () => {
    const def = getAiTaskDefinition('embedding');
    expect(def.task_type).toBe('embedding');
    expect(def.default_response_mode).toBe('embedding');
    expect(def.default_schema).toBeUndefined();
  });

  it('returns definition for context_summary', () => {
    const def = getAiTaskDefinition('context_summary');
    expect(def.task_type).toBe('context_summary');
    expect(def.default_schema?.required).toContain('summary');
  });

  it('returns definition for moderation', () => {
    const def = getAiTaskDefinition('moderation');
    expect(def.task_type).toBe('moderation');
    expect(def.default_schema?.required).toContain('allowed');
    expect(def.default_schema?.required).toContain('category');
  });

  it('returns definition for classification', () => {
    const def = getAiTaskDefinition('classification');
    expect(def.default_schema?.required).toContain('label');
  });

  it('returns definition for entity_extraction', () => {
    const def = getAiTaskDefinition('entity_extraction');
    expect(def.default_schema?.required).toContain('entities');
  });

  it('returns definition for all task types', () => {
    const taskTypes = [
      'agent_decision', 'intent_grounding_assist', 'context_summary',
      'memory_compaction', 'narrative_projection', 'entity_extraction',
      'classification', 'moderation', 'embedding', 'rerank'
    ];
    for (const taskType of taskTypes) {
       
      const def = getAiTaskDefinition(taskType as import('../../../src/ai/types.js').AiTaskType);
      expect(def.task_type).toBe(taskType);
    }
  });
});

describe('resolveAiTaskConfig', () => {
  it('resolves default config for agent_decision', () => {
    const config = resolveAiTaskConfig({ taskType: 'agent_decision' });
    expect(config.output.mode).toBe('json_schema');
    expect(config.output.strict).toBe(true);
    expect(config.parse.decoder).toBe('default_json_schema');
    expect(config.prompt.preset).toBe('default_decision_v1');
    expect(config.route.route_id).toBe('default.agent_decision');
    expect(config.tools).toEqual([]);
    expect(config.tool_policy.mode).toBe('disabled');
  });

  it('resolves default config for embedding', () => {
    const config = resolveAiTaskConfig({ taskType: 'embedding' });
    expect(config.output.mode).toBe('embedding');
    expect(config.output.strict).toBe(false);
    expect(config.parse.decoder).toBe('default_embedding');
  });

  it('applies pack config defaults', () => {
    const config = resolveAiTaskConfig({
      taskType: 'agent_decision',
      packAiConfig: {
        defaults: {
          prompt_preset: 'custom_preset',
          decoder: 'custom_decoder',
          route_id: 'custom-route',
          privacy_tier: 'local_only'
        }
      }
    });
    expect(config.prompt.preset).toBe('custom_preset');
    expect(config.parse.decoder).toBe('custom_decoder');
    expect(config.route.route_id).toBe('custom-route');
    expect(config.route.privacy_tier).toBe('local_only');
  });

  it('applies pack task override', () => {
    const config = resolveAiTaskConfig({
      taskType: 'agent_decision',
      packAiConfig: {
        tasks: {
          agent_decision: {
            output: { mode: 'json_object', strict: false },
            prompt: { system_append: 'extra context' },
            parse: { unwrap: 'data.result' }
          }
        }
      }
    });
    expect(config.output.mode).toBe('json_object');
    expect(config.output.strict).toBe(false);
    expect(config.prompt.system_append).toBe('extra context');
    expect(config.parse.unwrap).toBe('data.result');
  });

  it('applies inline override', () => {
    const config = resolveAiTaskConfig({
      taskType: 'agent_decision',
      inlineOverride: {
        output: { mode: 'free_text' },
        prompt: { user_prefix: 'Please answer:' }
      }
    });
    expect(config.output.mode).toBe('free_text');
    expect(config.prompt.user_prefix).toBe('Please answer:');
  });

  it('inline override takes precedence over pack override', () => {
    const config = resolveAiTaskConfig({
      taskType: 'agent_decision',
      packAiConfig: {
        tasks: {
          agent_decision: {
            output: { mode: 'json_object' },
            prompt: { system_append: 'from pack' }
          }
        }
      },
      inlineOverride: {
        output: { mode: 'free_text' },
        prompt: { system_append: 'from inline' }
      }
    });
    expect(config.output.mode).toBe('free_text');
    expect(config.prompt.system_append).toBe('from inline');
  });

  it('applies tool config from override', () => {
    const config = resolveAiTaskConfig({
      taskType: 'agent_decision',
      inlineOverride: {
        tools: ['search', 'write'],
        tool_policy: { mode: 'required' }
      }
    });
    expect(config.tools).toEqual(['search', 'write']);
    expect(config.tool_policy.mode).toBe('required');
  });

  it('preserves metadata from override', () => {
    const config = resolveAiTaskConfig({
      taskType: 'agent_decision',
      inlineOverride: {
        metadata: { custom_key: 'custom_value' }
      }
    });
    expect(config.metadata).toEqual({ custom_key: 'custom_value' });
  });

  it('returns null override when no overrides provided', () => {
    const config = resolveAiTaskConfig({ taskType: 'agent_decision' });
    expect(config.override).toBeNull();
  });

  it('returns merged override when pack override provided', () => {
    const config = resolveAiTaskConfig({
      taskType: 'agent_decision',
      packAiConfig: {
        tasks: {
          agent_decision: {
            prompt: { system_append: 'test' }
          }
        }
      }
    });
    expect(config.override).not.toBeNull();
    expect(config.override?.prompt?.system_append).toBe('test');
  });
});
