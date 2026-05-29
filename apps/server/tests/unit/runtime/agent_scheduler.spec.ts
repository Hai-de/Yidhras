import { describe, expect, it, vi } from 'vitest';

// Mock all deep service dependencies before importing
vi.mock('../../../src/app/services/inference_workflow.js', () => ({
  listActiveSchedulerAgents: vi.fn().mockResolvedValue([]),
  listPendingSchedulerDecisionJobs: vi.fn().mockResolvedValue([]),
  listPendingSchedulerActionIntents: vi.fn().mockResolvedValue([]),
  listRecentEventFollowupSignals: vi.fn().mockResolvedValue([]),
  listRecentRelationshipFollowupSignals: vi.fn().mockResolvedValue([]),
  listRecentSnrFollowupSignals: vi.fn().mockResolvedValue([]),
  listRecentOverlayFollowupSignals: vi.fn().mockResolvedValue([]),
  listRecentMemoryBlockFollowupSignals: vi.fn().mockResolvedValue([]),
  listRecentScheduledDecisionJobs: vi.fn().mockResolvedValue([]),
  listRecentRecoveryWindowActors: vi.fn().mockResolvedValue([]),
  createPendingDecisionJobIdempotent: vi.fn(),
  getLatestSchedulerSignalTick: vi.fn().mockReturnValue(null)
}));

vi.mock('../../../src/app/runtime/entity_activity_query.js', () => ({
  listActiveWorkflowActors: vi.fn().mockResolvedValue(new Set())
}));

vi.mock('../../../src/app/runtime/scheduler_decision_kernel_provider.js', () => ({
  createSchedulerDecisionKernelProvider: vi.fn().mockReturnValue({
    evaluateWithMetadata: vi.fn().mockResolvedValue({
      decisions: [],
      summary: { scanned: 0, eligible: 0, created: 0 }
    })
  })
}));

vi.mock('../../../src/app/runtime/scheduler_lease.js', () => ({
  acquireSchedulerLease: vi.fn().mockReturnValue({ acquired: true, lease: { holder: 'w1', expires_at: 999n } }),
  getSchedulerCursor: vi.fn().mockReturnValue(null),
  updateSchedulerCursor: vi.fn()
}));

vi.mock('../../../src/app/runtime/scheduler_ownership.js', () => ({
  resolveSchedulerOwnershipSnapshot: vi.fn().mockReturnValue({
    worker_id: 'worker-1',
    partition_count: 1,
    owned_partition_ids: ['p0'],
    assignment_source: 'bootstrap',
    migration_in_progress_count: 0,
    worker_runtime_status: 'active',
    last_heartbeat_at: 100n,
    automatic_rebalance_enabled: false
  }),
  isWorkerAllowedToOperateSchedulerPartition: vi.fn().mockReturnValue(true),
  completeActiveSchedulerOwnershipMigration: vi.fn(),
  refreshSchedulerWorkerRuntimeState: vi.fn(),
  refreshSchedulerWorkerRuntimeLiveness: vi.fn(),
  listSchedulerPartitionAssignments: vi.fn().mockReturnValue([])
}));

vi.mock('../../../src/app/runtime/scheduler_partitioning.js', () => ({
  getSchedulerPartitionCount: vi.fn().mockReturnValue(1),
  listSchedulerPartitionIds: vi.fn().mockReturnValue(['p0']),
  resolveOwnedSchedulerPartitionIds: vi.fn().mockReturnValue(['p0']),
  resolveSchedulerPartitionId: vi.fn().mockReturnValue('p0'),
  DEFAULT_SCHEDULER_PARTITION_ID: 'p0'
}));

vi.mock('../../../src/app/runtime/scheduler_rebalance.js', () => ({
  applySchedulerAutomaticRebalanceForWorker: vi.fn(),
  evaluateSchedulerAutomaticRebalance: vi.fn()
}));

vi.mock('../../../src/app/services/scheduler/writes.js', () => ({
  recordSchedulerRunSnapshot: vi.fn().mockResolvedValue('run-id-1')
}));

vi.mock('../../../src/app/services/workflow/workflow_trigger_scheduler.js', () => ({
  triggerEventWorkflows: vi.fn().mockResolvedValue({ triggered_count: 0 })
}));

vi.mock('../../../src/config/runtime_config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/runtime_config.js')>();
  return {
    ...actual,
    getSchedulerAgentConfig: vi.fn().mockReturnValue({
      limit: 50,
      cooldown_ticks: 5,
      max_candidates: 20,
      max_created_jobs_per_tick: 10,
      max_entity_activations_per_tick: 10,
      entity_single_flight_limit: 1,
      signal_policy: {
        event_followup: { priority_score: 100, delay_ticks: 1, coalesce_window_ticks: 3, suppression_tier: 'normal' },
        relationship_change_followup: { priority_score: 80, delay_ticks: 2, coalesce_window_ticks: 5, suppression_tier: 'normal' },
        snr_change_followup: { priority_score: 90, delay_ticks: 1, coalesce_window_ticks: 3, suppression_tier: 'normal' },
        overlay_change_followup: { priority_score: 70, delay_ticks: 2, coalesce_window_ticks: 5, suppression_tier: 'normal' },
        memory_change_followup: { priority_score: 60, delay_ticks: 2, coalesce_window_ticks: 5, suppression_tier: 'normal' }
      },
      recovery_suppression: {
        replay: { suppress_periodic: true, suppress_event_tiers: [] },
        retry: { suppress_periodic: false, suppress_event_tiers: [] }
      }
    }),
    getSchedulerDecisionKernelConfig: vi.fn().mockReturnValue({
      binary_path: 'scheduler-decision-sidecar',
      timeout_ms: 5000,
      auto_restart: true
    }),
    getSchedulerEntityConcurrencyConfig: vi.fn().mockReturnValue({
      max_candidates: 20,
      max_created_jobs_per_tick: 10,
      max_entity_activations_per_tick: 10,
      entity_single_flight_limit: 1
    }),
    getSchedulerTickBudgetConfig: vi.fn().mockReturnValue({
      max_rounds_per_tick: 3,
      max_steps_per_tick: 50,
      max_wall_time_ms_per_tick: 10000
    })
  };
});

vi.mock('../../../src/app/services/pack/pack_runtime_resolution.js', () => ({
  resolvePackTick: vi.fn().mockReturnValue(100n)
}));

vi.mock('../../../src/app/services/inference_workflow/parsers.js', () => ({
  normalizeStoredRequestInput: vi.fn().mockReturnValue({})
}));

vi.mock('../../../src/app/services/inference_workflow/types.js', () => ({
  isRecord: vi.fn().mockReturnValue(false)
}));

import { runAgentScheduler } from '../../../src/app/runtime/agent_scheduler.js';
import { createMockAppContext } from '../../helpers/mock_context.js';

/* ──────────────────── helpers ──────────────────── */

const createMockPackRuntime = () => ({
  getPack: () => ({
    metadata: { id: 'test-pack' },
    agents: [
      { id: 'agent-1', identity_id: 'id-1' },
      { id: 'agent-2', identity_id: 'id-2' }
    ],
    workflows: {}
  }),
  getPackId: () => 'test-pack',
  getCurrentTick: () => 100n,
  getCurrentRevision: () => 100n,
  getStepTicks: () => 1n,
  resolvePackVariables: (s: string) => s,
  getRuntimeSpeedSnapshot: () => ({
    mode: 'variable' as const,
    source: 'default' as const,
    strategy: { kind: 'variable' as const, range: { min: 1n, max: 1n }, loopIntervalMs: 1000 },
    effective_step_ticks: '1',
    override_since: null
  }),
  setRuntimeSpeedOverride: () => {},
  clearRuntimeSpeedOverride: () => {},
  getAllTimes: () => ({ current_tick: 100n }),
  step: async () => {},
  getPackSlotDeclarations: () => null,
  applyClockProjection: () => {}
});

/* ──────────────────── runAgentScheduler ──────────────────── */

describe('runAgentScheduler', () => {
  it('returns empty result when no owned partitions', async () => {
    const { resolveSchedulerOwnershipSnapshot } = await import('../../../src/app/runtime/scheduler_ownership.js');
    (resolveSchedulerOwnershipSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      worker_id: 'worker-1',
      partition_count: 0,
      owned_partition_ids: [],
      assignment_source: 'bootstrap',
      migration_in_progress_count: 0,
      worker_runtime_status: 'active',
      last_heartbeat_at: 100n,
      automatic_rebalance_enabled: false
    });

    const ctx = createMockAppContext();
    const result = await runAgentScheduler({
      context: ctx as never,
      packId: 'test-pack',
      packRuntime: createMockPackRuntime() as never,
      workerId: 'worker-1'
    });

    expect(result.partition_ids).toEqual([]);
    expect(result.scheduler_run_ids).toEqual([]);
    expect(result.created_count).toBe(0);

    // Restore
    (resolveSchedulerOwnershipSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      worker_id: 'worker-1',
      partition_count: 1,
      owned_partition_ids: ['p0'],
      assignment_source: 'bootstrap',
      migration_in_progress_count: 0,
      worker_runtime_status: 'active',
      last_heartbeat_at: 100n,
      automatic_rebalance_enabled: false
    });
  });

  it('handles missing packRuntime gracefully', async () => {
    const { resolveSchedulerOwnershipSnapshot } = await import('../../../src/app/runtime/scheduler_ownership.js');
    (resolveSchedulerOwnershipSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      worker_id: 'worker-1',
      partition_count: 0,
      owned_partition_ids: [],
      assignment_source: 'bootstrap',
      migration_in_progress_count: 0,
      worker_runtime_status: 'active',
      last_heartbeat_at: 100n,
      automatic_rebalance_enabled: false
    });

    const ctx = createMockAppContext();
    const result = await runAgentScheduler({
      context: ctx as never,
      packId: 'test-pack',
      packRuntime: undefined,
      workerId: 'worker-1'
    });

    expect(result.partition_ids).toEqual([]);
    expect(result.created_count).toBe(0);

    // Restore
    (resolveSchedulerOwnershipSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      worker_id: 'worker-1',
      partition_count: 1,
      owned_partition_ids: ['p0'],
      assignment_source: 'bootstrap',
      migration_in_progress_count: 0,
      worker_runtime_status: 'active',
      last_heartbeat_at: 100n,
      automatic_rebalance_enabled: false
    });
  });

  it('processes assigned partition with empty agents', async () => {
    const ctx = createMockAppContext();
    const emptyPackRuntime = {
      ...createMockPackRuntime(),
      getPack: () => ({
        metadata: { id: 'test-pack' },
        agents: [],
        workflows: {}
      })
    };

    const result = await runAgentScheduler({
      context: ctx as never,
      packId: 'test-pack',
      packRuntime: emptyPackRuntime as never,
      workerId: 'worker-1'
    });

    expect(result.partition_ids).toContain('p0');
    expect(result.scanned_count).toBe(0);
    expect(result.created_count).toBe(0);
  });

  it('uses default workerId when not provided', async () => {
    const ctx = createMockAppContext();
    const result = await runAgentScheduler({
      context: ctx as never,
      packId: 'test-pack',
      packRuntime: createMockPackRuntime() as never
    });

    expect(result.partition_ids).toContain('p0');
  });

  it('handles custom limit and cooldownTicks', async () => {
    const ctx = createMockAppContext();
    const result = await runAgentScheduler({
      context: ctx as never,
      packId: 'test-pack',
      packRuntime: createMockPackRuntime() as never,
      workerId: 'worker-1',
      limit: 5,
      cooldownTicks: 10n,
      strategy: 'behavior_tree',
      schedulerReason: 'event_followup'
    });

    expect(result.partition_ids).toContain('p0');
  });

  it('skips partition when lease not acquired', async () => {
    const { acquireSchedulerLease } = await import('../../../src/app/runtime/scheduler_lease.js');
    (acquireSchedulerLease as ReturnType<typeof vi.fn>).mockReturnValueOnce({ acquired: false });

    const ctx = createMockAppContext();
    const result = await runAgentScheduler({
      context: ctx as never,
      packId: 'test-pack',
      packRuntime: createMockPackRuntime() as never,
      workerId: 'worker-1'
    });

    expect(result.partition_ids).toContain('p0');
    expect(result.created_count).toBe(0);
  });

  it('skips partition when worker not allowed', async () => {
    const { isWorkerAllowedToOperateSchedulerPartition } = await import('../../../src/app/runtime/scheduler_ownership.js');
    (isWorkerAllowedToOperateSchedulerPartition as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

    const ctx = createMockAppContext();
    const result = await runAgentScheduler({
      context: ctx as never,
      packId: 'test-pack',
      packRuntime: createMockPackRuntime() as never,
      workerId: 'worker-1'
    });

    expect(result.partition_ids).toContain('p0');
    expect(result.created_count).toBe(0);
  });
});
