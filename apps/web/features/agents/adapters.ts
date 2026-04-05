import type { AgentOverviewSnapshot } from '../../composables/api/useAgentApi'
import type { AgentSchedulerProjection, SchedulerDecisionItem } from '../../composables/api/useSchedulerApi'

export interface AgentSectionField {
  label: string
  value: string
}

export interface AgentSchedulerDecisionViewModel {
  id: string
  title: string
  meta: string
  detail: string
  outcomeLabel: string
  createdJobId: string | null
}

export interface AgentSchedulerSummaryMetric {
  id: string
  label: string
  value: string
}

export interface AgentSchedulerBreakdownItem {
  id: string
  label: string
  value: string
}

export interface AgentSchedulerLinkItem {
  id: string
  title: string
  meta: string
}

export const buildAgentProfileFields = (snapshot: AgentOverviewSnapshot): AgentSectionField[] => {
  return [
    { label: 'name', value: snapshot.profile.name },
    { label: 'type', value: snapshot.profile.type },
    { label: 'snr', value: String(snapshot.profile.snr) },
    { label: 'is_pinned', value: String(snapshot.profile.is_pinned) },
    { label: 'created_at', value: snapshot.profile.created_at },
    { label: 'updated_at', value: snapshot.profile.updated_at }
  ]
}

export const buildAgentRelationshipFields = (snapshot: AgentOverviewSnapshot): AgentSectionField[] => {
  return [
    { label: 'incoming', value: String(snapshot.relationship_summary.counts.incoming) },
    { label: 'outgoing', value: String(snapshot.relationship_summary.counts.outgoing) },
    { label: 'total', value: String(snapshot.relationship_summary.counts.total) },
    { label: 'bindings(active)', value: String(snapshot.binding_summary.counts.active) },
    { label: 'bindings(atmosphere)', value: String(snapshot.binding_summary.counts.atmosphere) },
    { label: 'recent traces', value: String(snapshot.memory.summary.recent_trace_count) }
  ]
}

export const buildAgentSchedulerDecisionItems = (
  decisions: SchedulerDecisionItem[]
): AgentSchedulerDecisionViewModel[] => {
  return decisions.map(decision => ({
    id: decision.id,
    title: `${decision.chosen_reason} · ${decision.kind}`,
    meta: `tick ${decision.scheduled_for_tick} · ${decision.partition_id} · priority ${decision.priority_score}`,
    detail: decision.skipped_reason
      ? `Skipped: ${decision.skipped_reason}`
      : decision.workflow_link?.job_id
        ? `Created workflow job ${decision.workflow_link.job_id} · state ${decision.workflow_link.workflow_state ?? 'unknown'}`
        : decision.created_job_id
          ? `Created job ${decision.created_job_id}`
          : 'No workflow job was materialized from this decision.',
    outcomeLabel: decision.workflow_link?.job_id || decision.created_job_id ? 'Open workflow' : 'Inspect agent context',
    createdJobId: decision.workflow_link?.job_id ?? decision.created_job_id
  }))
}

export const buildAgentSchedulerSummaryMetrics = (
  projection: AgentSchedulerProjection | null
): AgentSchedulerSummaryMetric[] => {
  if (!projection) {
    return []
  }

  return [
    {
      id: 'scheduler-total-decisions',
      label: 'Recent Decisions',
      value: String(projection.summary.total_decisions)
    },
    {
      id: 'scheduler-created-count',
      label: 'Created Jobs',
      value: String(projection.summary.created_count)
    },
    {
      id: 'scheduler-skipped-count',
      label: 'Skipped',
      value: String(projection.summary.skipped_count)
    },
    {
      id: 'scheduler-latest-tick',
      label: 'Latest Tick',
      value: projection.summary.latest_scheduled_tick ?? '—'
    },
    {
      id: 'scheduler-top-reason',
      label: 'Primary Reason',
      value: projection.summary.top_reason
        ? `${projection.summary.top_reason.reason} · ${projection.summary.top_reason.count}`
        : '—'
    },
    {
      id: 'scheduler-top-skipped-reason',
      label: 'Top Skipped',
      value: projection.summary.top_skipped_reason
        ? `${projection.summary.top_skipped_reason.skipped_reason} · ${projection.summary.top_skipped_reason.count}`
        : '—'
    }
  ]
}

export const buildAgentSchedulerBreakdownItems = (
  projection: AgentSchedulerProjection | null
): AgentSchedulerBreakdownItem[] => {
  if (!projection) {
    return []
  }

  return [
    {
      id: 'scheduler-created-vs-skipped',
      label: 'Created / Skipped',
      value: `${projection.summary.created_count} / ${projection.summary.skipped_count}`
    },
    {
      id: 'scheduler-periodic-vs-event',
      label: 'Periodic / Event',
      value: `${projection.summary.periodic_count} / ${projection.summary.event_driven_count}`
    },
    {
      id: 'scheduler-latest-run',
      label: 'Latest Run',
      value: projection.summary.latest_run_id ?? '—'
    },
    {
      id: 'scheduler-latest-partition',
      label: 'Latest Partition',
      value: projection.summary.latest_partition_id ?? '—'
    }
  ]
}

export const buildAgentSchedulerReasonList = (projection: AgentSchedulerProjection | null): string[] => {
  if (!projection) {
    return []
  }

  return projection.reason_breakdown.slice(0, 4).map(item => `${item.reason} · ${item.count}`)
}

export const buildAgentSchedulerSkippedReasonList = (projection: AgentSchedulerProjection | null): string[] => {
  if (!projection) {
    return []
  }

  return projection.skipped_reason_breakdown.slice(0, 4).map(item => `${item.skipped_reason} · ${item.count}`)
}

export const buildAgentSchedulerRunLinks = (projection: AgentSchedulerProjection | null): AgentSchedulerLinkItem[] => {
  if (!projection) {
    return []
  }

  return projection.linkage.recent_runs.map(item => ({
    id: item.run_id,
    title: `Run ${item.run_id}`,
    meta: `tick ${item.tick} · ${item.partition_id} · ${item.worker_id}`
  }))
}

export const buildAgentSchedulerJobLinks = (projection: AgentSchedulerProjection | null): AgentSchedulerLinkItem[] => {
  if (!projection) {
    return []
  }

  return projection.linkage.recent_created_jobs.map(item => ({
    id: item.job_id,
    title: `Job ${item.job_id}`,
    meta: `decision ${item.decision_id} · ${item.partition_id} · tick ${item.scheduled_for_tick}`
  }))
}
