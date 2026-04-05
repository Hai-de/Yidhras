import { describe, expect, it } from 'vitest'

import type {
  SchedulerDecisionItem,
  SchedulerOperatorProjection,
  SchedulerRunSummary,
  SchedulerSummarySnapshot,
  SchedulerTrendPoint
} from '../../composables/api/useSchedulerApi'
import {
  buildSchedulerDecisionListItems,
  buildSchedulerHighlightGroups,
  buildSchedulerRunListItems,
  buildSchedulerSummaryMetrics,
  buildSchedulerTrendItems
} from '../../features/overview/adapters'

const createSchedulerSummary = (): SchedulerSummarySnapshot => ({
  latest_run: {
    id: 'run-latest',
    worker_id: 'worker-a',
    partition_id: 'p2',
    lease_holder: 'worker-a',
    lease_expires_at_snapshot: '1005',
    tick: '1000',
    summary: {
      scanned_count: 12,
      eligible_count: 8,
      created_count: 4,
      skipped_pending_count: 2,
      skipped_cooldown_count: 1,
      created_periodic_count: 3,
      created_event_driven_count: 1,
      signals_detected_count: 5,
      scheduled_for_future_count: 0,
      skipped_existing_idempotency_count: 0,
      skipped_by_reason: {}
    },
    started_at: '1000',
    finished_at: '1001',
    created_at: '1001',
    cross_link_summary: {
      linked_workflow_count: 4,
      workflow_state_breakdown: [{ workflow_state: 'completed', count: 3 }],
      linked_intent_type_breakdown: [{ intent_type: 'post_message', count: 4 }],
      status_breakdown: [{ status: 'completed', count: 4 }],
      recent_audit_summaries: [{ job_id: 'job-1', summary: 'ok' }]
    }
  },
  run_totals: {
    sampled_runs: 6,
    created_total: 9,
    created_periodic_total: 6,
    created_event_driven_total: 3,
    skipped_pending_total: 4,
    skipped_cooldown_total: 2,
    signals_detected_total: 11
  },
  top_reasons: [
    { reason: 'periodic_tick', count: 5 },
    { reason: 'event_followup', count: 3 }
  ],
  top_skipped_reasons: [
    { skipped_reason: 'pending_workflow', count: 4 },
    { skipped_reason: 'periodic_cooldown', count: 2 }
  ],
  top_actors: [
    { actor_id: 'agent-1', count: 3 },
    { actor_id: 'agent-2', count: 2 }
  ],
  top_partitions: [
    { partition_id: 'p2', count: 4 },
    { partition_id: 'p3', count: 2 }
  ],
  top_workers: [
    { worker_id: 'worker-a', count: 4 },
    { worker_id: 'worker-b', count: 2 }
  ],
  intent_class_breakdown: [
    { intent_class: 'scheduler_periodic', count: 6 },
    { intent_class: 'scheduler_event_followup', count: 3 }
  ]
})

const createProjection = (): SchedulerOperatorProjection => ({
  latest_run: null,
  summary: createSchedulerSummary(),
  trends: { points: createTrendPoints() },
  recent_runs: createRuns(),
  recent_decisions: createDecisions(),
  ownership: {
    assignments: [],
    recent_migrations: [],
    summary: {
      returned: 2,
      assigned_count: 2,
      migrating_count: 1,
      released_count: 0,
      active_partition_count: 2,
      top_workers: [{ worker_id: 'worker-a', partition_count: 2 }],
      source_breakdown: [{ source: 'rebalance', count: 1 }]
    }
  },
  workers: {
    items: [
      {
        worker_id: 'worker-a',
        status: 'active',
        last_heartbeat_at: '1001',
        owned_partition_count: 2,
        active_migration_count: 1,
        capacity_hint: 4,
        updated_at: '1001'
      },
      {
        worker_id: 'worker-b',
        status: 'stale',
        last_heartbeat_at: '995',
        owned_partition_count: 0,
        active_migration_count: 0,
        capacity_hint: 4,
        updated_at: '1001'
      }
    ],
    summary: {
      returned: 2,
      active_count: 1,
      stale_count: 1,
      suspected_dead_count: 0,
      filters: {
        worker_id: null,
        status: null
      }
    }
  },
  rebalance: {
    recommendations: [],
    summary: {
      returned: 1,
      limit: 5,
      status_breakdown: [{ status: 'applied', count: 1 }],
      suppress_reason_breakdown: [],
      filters: {
        worker_id: null,
        partition_id: null,
        status: null,
        suppress_reason: null
      }
    }
  },
  highlights: {
    latest_partition_id: 'p2',
    latest_created_workflow_count: 4,
    latest_skipped_count: 2,
    latest_top_reason: 'periodic_tick',
    latest_top_intent_type: 'post_message',
    latest_top_workflow_state: 'completed',
    latest_top_skipped_reason: 'pending_workflow',
    latest_top_failure_code: 'WORKFLOW_FAILED',
    latest_failed_workflow_count: 1,
    latest_pending_workflow_count: 1,
    latest_completed_workflow_count: 3,
    latest_top_actor: 'agent-1',
    migration_in_progress_count: 1,
    latest_migration_partition_id: 'p2',
    latest_migration_to_worker_id: 'worker-a',
    top_owner_worker_id: 'worker-a',
    latest_rebalance_status: 'applied',
    latest_rebalance_partition_id: 'p2',
    latest_rebalance_suppress_reason: null,
    latest_stale_worker_id: 'worker-b'
  }
})

const createTrendPoints = (): SchedulerTrendPoint[] => [
  {
    tick: '1000',
    run_id: 'run-1',
    partition_id: 'p0',
    worker_id: 'worker-a',
    created_count: 4,
    created_periodic_count: 3,
    created_event_driven_count: 1,
    signals_detected_count: 5,
    skipped_by_reason: { replay_window_event_suppressed: 1 }
  },
  {
    tick: '1002',
    run_id: 'run-2',
    partition_id: 'p0',
    worker_id: 'worker-a',
    created_count: 2,
    created_periodic_count: 1,
    created_event_driven_count: 1,
    signals_detected_count: 3,
    skipped_by_reason: { retry_window_event_suppressed: 1 }
  }
]

const createRuns = (): SchedulerRunSummary[] => [
  {
    id: 'run-1',
    worker_id: 'worker-a',
    partition_id: 'p0',
    lease_holder: 'worker-a',
    lease_expires_at_snapshot: '1005',
    tick: '1000',
    summary: {
      scanned_count: 12,
      eligible_count: 8,
      created_count: 4,
      skipped_pending_count: 2,
      skipped_cooldown_count: 1,
      created_periodic_count: 3,
      created_event_driven_count: 1,
      signals_detected_count: 5,
      scheduled_for_future_count: 0,
      skipped_existing_idempotency_count: 0,
      skipped_by_reason: {}
    },
    started_at: '1000',
    finished_at: '1001',
    created_at: '1001',
    cross_link_summary: {
      linked_workflow_count: 4,
      workflow_state_breakdown: [{ workflow_state: 'completed', count: 3 }],
      linked_intent_type_breakdown: [{ intent_type: 'post_message', count: 4 }],
      status_breakdown: [{ status: 'completed', count: 4 }],
      recent_audit_summaries: [{ job_id: 'job-1', summary: 'ok' }]
    }
  }
]

const createDecisions = (): SchedulerDecisionItem[] => [
  {
    id: 'decision-1',
    scheduler_run_id: 'run-1',
    partition_id: 'p0',
    actor_id: 'agent-1',
    kind: 'periodic',
    candidate_reasons: ['periodic_tick'],
    chosen_reason: 'periodic_tick',
    scheduled_for_tick: '1000',
    priority_score: 1,
    skipped_reason: null,
    coalesced_secondary_reason_count: 0,
    has_coalesced_signals: false,
    created_job_id: 'job-1',
    created_at: '1000',
    workflow_link: {
      job_id: 'job-1',
      status: 'completed',
      intent_class: 'scheduler_periodic',
      workflow_state: 'completed',
      action_intent_id: 'intent-1',
      inference_id: 'trace-1',
      intent_type: 'post_message',
      dispatch_stage: 'completed',
      failure_stage: null,
      failure_code: null,
      outcome_summary_excerpt: null,
      audit_entry: null
    }
  },
  {
    id: 'decision-2',
    scheduler_run_id: 'run-2',
    partition_id: 'p2',
    actor_id: 'agent-2',
    kind: 'event_driven',
    candidate_reasons: ['event_followup'],
    chosen_reason: 'event_followup',
    scheduled_for_tick: '1002',
    priority_score: 30,
    skipped_reason: 'pending_workflow',
    coalesced_secondary_reason_count: 1,
    has_coalesced_signals: true,
    created_job_id: null,
    created_at: '1002',
    workflow_link: null
  }
]

describe('overview scheduler adapters', () => {
  it('builds scheduler summary metrics from summary snapshot and projection highlights', () => {
    expect(buildSchedulerSummaryMetrics(createSchedulerSummary(), createProjection())).toEqual([
      { id: 'scheduler-sampled-runs', label: 'Sampled Runs', value: '6' },
      { id: 'scheduler-created-total', label: 'Created Jobs', value: '9' },
      { id: 'scheduler-skipped-pending', label: 'Skipped Pending', value: '4' },
      { id: 'scheduler-signals', label: 'Signals Detected', value: '11' },
      { id: 'scheduler-migrations-in-progress', label: 'Migrations In Progress', value: '1' },
      { id: 'scheduler-stale-workers', label: 'Stale Workers', value: '1' }
    ])
  })

  it('builds scheduler highlight groups with readable aggregate labels', () => {
    const groups = buildSchedulerHighlightGroups(createSchedulerSummary(), createProjection())

    expect(groups).toHaveLength(7)
    expect(groups[0]).toEqual({
      title: 'Latest Highlights',
      items: ['Latest partition · p2', 'Created workflows · 4', 'Skipped decisions · 2', 'Rebalance · applied']
    })
    expect(groups[1]).toEqual({
      title: 'Top Reasons',
      items: ['periodic_tick · 5', 'event_followup · 3']
    })
    expect(groups[2]).toEqual({
      title: 'Top Skipped',
      items: ['pending_workflow · 4', 'periodic_cooldown · 2']
    })
    expect(groups[3]).toEqual({
      title: 'Top Actors',
      items: ['agent-1 · 3', 'agent-2 · 2']
    })
    expect(groups[4]).toEqual({
      title: 'Worker Health',
      items: ['worker-a · active · partitions 2', 'worker-b · stale · partitions 0']
    })
    expect(groups[5]).toEqual({
      title: 'Intent Classes',
      items: ['scheduler_periodic · 6', 'scheduler_event_followup · 3']
    })
    expect(groups[6]).toEqual({
      title: 'Ownership / Rebalance',
      items: ['Top owner · worker-a', 'Stale worker · worker-b', 'Latest migration · p2', 'Latest rebalance partition · p2']
    })
  })

  it('builds trend items, run list items, and decision list items for operator UI', () => {
    expect(buildSchedulerTrendItems(createTrendPoints())).toEqual([
      {
        id: 'run-1',
        tick: '1000',
        createdCount: '4',
        cadenceBreakdown: '3 periodic · 1 event',
        signalsDetected: '5'
      },
      {
        id: 'run-2',
        tick: '1002',
        createdCount: '2',
        cadenceBreakdown: '1 periodic · 1 event',
        signalsDetected: '3'
      }
    ])

    expect(buildSchedulerRunListItems(createRuns())).toEqual([
      {
        id: 'run-1',
        title: 'tick 1000 · p0 · created 4',
        meta: 'worker-a · signals 5 · skipped 3',
        tone: 'info',
        actionLabel: 'Open workflow context'
      }
    ])

    expect(buildSchedulerDecisionListItems(createDecisions())).toEqual([
      {
        id: 'decision-1',
        title: 'agent-1 · periodic_tick',
        meta: 'periodic · p0 · priority 1 · tick 1000 · job job-1',
        tone: 'success',
        actionLabel: 'Open workflow'
      },
      {
        id: 'decision-2',
        title: 'agent-2 · event_followup',
        meta: 'event_driven · p2 · priority 30 · tick 1002 · skipped pending_workflow',
        tone: 'warning',
        actionLabel: 'Open agent'
      }
    ])
  })
})
