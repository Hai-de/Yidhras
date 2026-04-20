import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createSchedulerDecisionKernelProvider } from '../../src/app/runtime/scheduler_decision_kernel_provider.js';
import type { SchedulerKernelEvaluateInput } from '../../src/app/runtime/scheduler_decision_kernel_port.js';
import { resetRuntimeConfigCache } from '../../src/config/runtime_config.js';

const buildInput = (): SchedulerKernelEvaluateInput => ({
  partition_id: 'p0',
  now_tick: '100',
  scheduler_reason: 'periodic_tick',
  limit: 10,
  cooldown_ticks: '5',
  max_candidates: 10,
  max_created_jobs_per_tick: 10,
  max_entity_activations_per_tick: 10,
  entity_single_flight_limit: 2,
  agents: [
    { id: 'agent-a', partition_id: 'p0' },
    { id: 'agent-b', partition_id: 'p0' }
  ],
  recent_signals: [
    { agent_id: 'agent-b', reason: 'event_followup', created_at: '100' },
    { agent_id: 'agent-b', reason: 'relationship_change_followup', created_at: '100' }
  ],
  pending_intent_agent_ids: [],
  pending_job_keys: [],
  active_workflow_actor_ids: [],
  recent_scheduled_tick_by_agent: {},
  replay_recovery_actor_ids: [],
  retry_recovery_actor_ids: [],
  per_tick_activation_counts: {},
  signal_policy: {
    event_followup: { priority_score: 8, delay_ticks: '1', coalesce_window_ticks: '2', suppression_tier: 'high' },
    relationship_change_followup: { priority_score: 10, delay_ticks: '3', coalesce_window_ticks: '2', suppression_tier: 'high' },
    snr_change_followup: { priority_score: 7, delay_ticks: '2', coalesce_window_ticks: '2', suppression_tier: 'low' },
    overlay_change_followup: { priority_score: 6, delay_ticks: '2', coalesce_window_ticks: '2', suppression_tier: 'low' },
    memory_change_followup: { priority_score: 5, delay_ticks: '2', coalesce_window_ticks: '2', suppression_tier: 'low' }
  },
  recovery_suppression: {
    replay: { suppress_periodic: true, suppress_event_tiers: ['high'] },
    retry: { suppress_periodic: true, suppress_event_tiers: ['high', 'low'] }
  }
});

describe('scheduler decision sidecar parity integration', () => {
  afterAll(() => {
    resetRuntimeConfigCache();
  });

  beforeEach(() => {
    resetRuntimeConfigCache();
  });

  it('returns parity metadata in rust_shadow mode for a representative fixture', async () => {
    const provider = createSchedulerDecisionKernelProvider({
      mode: 'rust_shadow',
      timeoutMs: 2000,
      binaryPath: 'apps/server/rust/scheduler_decision_sidecar/target/debug/scheduler_decision_sidecar',
      autoRestart: true
    });

    const result = await provider.evaluateWithMetadata(buildInput());

    expect(result.metadata.provider).toBe('rust_shadow');
    expect(['match', 'diff', 'skipped']).toContain(result.metadata.parity_status);
    expect(typeof result.metadata.parity_diff_count).toBe('number');
    expect(result.output.job_drafts.length).toBeGreaterThan(0);
    expect(result.output.candidate_decisions.some(item => item.kind === 'event_driven')).toBe(true);
  });
});
