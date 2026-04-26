import { describe, expect, it } from 'vitest';

import { resolveAiTaskConfig } from '../../src/ai/task_definitions.js';

describe('resolveAiTaskConfig', () => {
  it('resolves death note pack ai task overrides for grounding/summary/compaction/classification', () => {
    const packAiConfig = {
      memory_loop: {
        summary_every_n_rounds: 5,
        compaction_every_n_rounds: 5
      },
      tasks: {
        intent_grounding_assist: {
          prompt: { preset: 'death_note_intent_grounding_v1' },
          metadata: { fallback_policy: 'prefer_existing_capability_or_narrativized' }
        },
        context_summary: {
          prompt: { preset: 'death_note_context_summary_v1' },
          metadata: { summary_axes: ['investigation_heat', 'evidence_chain_strength'] }
        },
        memory_compaction: {
          prompt: { preset: 'death_note_memory_compaction_v1' },
          metadata: { retention_bias: ['target_identity_confirmation', 'execution_postmortem'] }
        },
        classification: {
          prompt: { preset: 'death_note_classification_v1' },
          metadata: { labels: ['execution_window', 'false_lead', 'pressure_escalation'] }
        }
      }
    } as const;

    expect(resolveAiTaskConfig({ taskType: 'intent_grounding_assist', packAiConfig }).prompt.preset).toBe('death_note_intent_grounding_v1');
    expect(resolveAiTaskConfig({ taskType: 'intent_grounding_assist', packAiConfig }).metadata).toMatchObject({ fallback_policy: 'prefer_existing_capability_or_narrativized' });
    expect(resolveAiTaskConfig({ taskType: 'context_summary', packAiConfig }).prompt.preset).toBe('death_note_context_summary_v1');
    expect(resolveAiTaskConfig({ taskType: 'context_summary', packAiConfig }).metadata).toMatchObject({ summary_axes: ['investigation_heat', 'evidence_chain_strength'] });
    expect(resolveAiTaskConfig({ taskType: 'memory_compaction', packAiConfig }).prompt.preset).toBe('death_note_memory_compaction_v1');
    expect(resolveAiTaskConfig({ taskType: 'memory_compaction', packAiConfig }).metadata).toMatchObject({ retention_bias: ['target_identity_confirmation', 'execution_postmortem'] });
    expect(resolveAiTaskConfig({ taskType: 'classification', packAiConfig }).prompt.preset).toBe('death_note_classification_v1');
    expect(resolveAiTaskConfig({ taskType: 'classification', packAiConfig }).metadata).toMatchObject({ labels: ['execution_window', 'false_lead', 'pressure_escalation'] });
    expect(resolveAiTaskConfig({ taskType: 'intent_grounding_assist', packAiConfig }).route.route_id).toBe('default.context_summary');
    expect(resolveAiTaskConfig({ taskType: 'context_summary', packAiConfig }).route.route_id).toBe('default.context_summary');
  });

  it('prefers explicit pack task route override for intent grounding assist when provided', () => {
    const packAiConfig = {
      tasks: {
        intent_grounding_assist: {
          route: {
            route_id: 'default.context_summary',
            provider: 'openai',
            model: 'gpt-4.1-mini'
          }
        }
      }
    } as const;

    expect(resolveAiTaskConfig({ taskType: 'intent_grounding_assist', packAiConfig }).route.route_id).toBe('default.context_summary');
  });
});
