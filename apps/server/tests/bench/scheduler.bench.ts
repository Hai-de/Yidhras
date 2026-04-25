import { bench, describe } from 'vitest';

import { resolveAiRoute } from '../../src/ai/route_resolver.js';
import { resolveAiTaskConfig } from '../../src/ai/task_definitions.js';
import { createEmptySchedulerRunResult, createInitialSkipCounts } from '../../src/app/runtime/scheduler_decision_kernel_port.js';

describe('scheduler benchmarks', () => {
  describe('port utilities', () => {
    bench('createInitialSkipCounts', () => {
      createInitialSkipCounts();
    });

    bench('createEmptySchedulerRunResult', () => {
      createEmptySchedulerRunResult('partition-1');
    });
  });

  describe('route resolution for scheduler task types', () => {
    bench('resolve route for agent_decision', () => {
      resolveAiRoute({ task_type: 'agent_decision', response_mode: 'json_schema' });
    });

    bench('resolve route for context_summary', () => {
      resolveAiRoute({ task_type: 'context_summary', response_mode: 'json_object' });
    });

    bench('resolve route for classification', () => {
      resolveAiRoute({ task_type: 'classification', response_mode: 'json_schema' });
    });
  });

  describe('task config resolution', () => {
    const packAiConfig = {
      memory_loop: { summary_every_n_rounds: 5, compaction_every_n_rounds: 5 },
      tasks: {
        agent_decision: { prompt: { preset: 'death_note_agent_decision_v1', system_append: 'system append' }, parse: { required_fields: ['action_type', 'payload'] } },
        context_summary: { prompt: { preset: 'death_note_context_summary_v1' }, metadata: { summary_axes: ['investigation_heat'] } },
        memory_compaction: { prompt: { preset: 'death_note_memory_compaction_v1' }, metadata: { retention_bias: ['target_identity_confirmation'] } }
      }
    };

    bench('resolve task config for agent_decision', () => {
      resolveAiTaskConfig({ taskType: 'agent_decision', packAiConfig });
    });

    bench('resolve task config for context_summary', () => {
      resolveAiTaskConfig({ taskType: 'context_summary', packAiConfig });
    });

    bench('resolve task config for memory_compaction', () => {
      resolveAiTaskConfig({ taskType: 'memory_compaction', packAiConfig });
    });

    bench('resolve task config for classification (no override)', () => {
      resolveAiTaskConfig({ taskType: 'classification', packAiConfig });
    });
  });
});
