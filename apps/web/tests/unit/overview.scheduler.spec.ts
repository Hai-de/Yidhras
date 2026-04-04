import { describe, expect, it } from 'vitest'

import type {
  SchedulerDecisionItem,
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
    created_at: '1001'
  },
  run_totals: {
    sampled_runs: 6,
    total_created_count: 9,
    total_created_periodic_count: 6,
    total_created_event_driven_count: 3,
    total_skipped_pending_count: 4,
    total_skipped_cooldown_count: 2,
    total_signals_detected_count: 11,
    total_scheduled_for_future_count: 1,
    total_skipped_existing_idempotency_count: 0
  },
  top_reasons: [
    { reason: 'periodic_tick', count: 5 },
    { reason: 'event_followup', count: 3 }
  ],
  top_skipped_reasons: [
    { reason: 'pending_workflow', count: 4 },
    { reason: 'periodic_cooldown', count: 2 }
  ],
  top_actors: [
    { actor_id: 'agent-1', count: 3 },
    { actor_id: 'agent-2', count: 2 }
  ],
  intent_class_breakdown: [
    { intent_class: 'scheduler_periodic', count: 6 },
    { intent_class: 'scheduler_event_followup', count: 3 }
  ]
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
    created_at: '1001'
  }
]

const createDecisions = (): SchedulerDecisionItem[] => [
  {
    id: 'decision-1',
    actor_id: 'agent-1',
    kind: 'periodic',
    candidate_reasons: ['periodic_tick'],
    chosen_reason: 'periodic_tick',
    scheduled_for_tick: '1000',
    priority_score: 1,
    skipped_reason: null,
    created_job_id: 'job-1',
    created_at: '1000'
  },
  {
    id: 'decision-2',
    actor_id: 'agent-2',
    kind: 'event_driven',
    candidate_reasons: ['event_followup'],
    chosen_reason: 'event_followup',
    scheduled_for_tick: '1002',
    priority_score: 30,
    skipped_reason: 'pending_workflow',
    created_job_id: null,
    created_at: '1002'
  }
]

describe('overview scheduler adapters', () => {
  it('builds scheduler summary metrics from summary snapshot', () => {
    expect(buildSchedulerSummaryMetrics(createSchedulerSummary())).toEqual([
      { id: 'scheduler-sampled-runs', label: 'Sampled Runs', value: '6' },
      { id: 'scheduler-created-total', label: 'Created Jobs', value: '9' },
      { id: 'scheduler-skipped-pending', label: 'Skipped Pending', value: '4' },
      { id: 'scheduler-signals', label: 'Signals Detected', value: '11' }
    ])
  })

  it('builds scheduler highlight groups with readable aggregate labels', () => {
    const groups = buildSchedulerHighlightGroups(createSchedulerSummary())

    expect(groups).toHaveLength(4)
    expect(groups[0]).toEqual({
      title: 'Top Reasons',
      items: ['periodic_tick · 5', 'event_followup · 3']
    })
    expect(groups[1]).toEqual({
      title: 'Top Skipped',
      items: ['pending_workflow · 4', 'periodic_cooldown · 2']
    })
    expect(groups[2]).toEqual({
      title: 'Top Actors',
      items: ['agent-1 · 3', 'agent-2 · 2']
    })
    expect(groups[3]).toEqual({
      title: 'Intent Classes',
      items: ['scheduler_periodic · 6', 'scheduler_event_followup · 3']
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
        title: 'tick 1000 · created 4 · scanned 12',
        meta: 'worker-a · signals 5 · skipped 3',
        tone: 'info',
        actionLabel: 'Open workflow context'
      }
    ])

    expect(buildSchedulerDecisionListItems(createDecisions())).toEqual([
      {
        id: 'decision-1',
        title: 'agent-1 · periodic_tick',
        meta: 'periodic · priority 1 · tick 1000 · job job-1',
        tone: 'success',
        actionLabel: 'Open workflow'
      },
      {
        id: 'decision-2',
        title: 'agent-2 · event_followup',
        meta: 'event_driven · priority 30 · tick 1002 · skipped pending_workflow',
        tone: 'warning',
        actionLabel: 'Open agent'
      }
    ])
  })
})
