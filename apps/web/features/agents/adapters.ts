import type { AgentOverviewSnapshot } from '../../composables/api/useAgentApi'
import type { SchedulerDecisionItem } from '../../composables/api/useSchedulerApi'

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
    meta: `tick ${decision.scheduled_for_tick} · priority ${decision.priority_score}`,
    detail: decision.skipped_reason
      ? `Skipped: ${decision.skipped_reason}`
      : decision.created_job_id
        ? `Created job ${decision.created_job_id}`
        : 'No workflow job was materialized from this decision.',
    outcomeLabel: decision.created_job_id ? 'Open workflow' : 'Inspect workflow context',
    createdJobId: decision.created_job_id
  }))
}

export const buildAgentSchedulerSummaryMetrics = (
  decisions: SchedulerDecisionItem[]
): AgentSchedulerSummaryMetric[] => {
  const createdCount = decisions.filter(item => Boolean(item.created_job_id)).length
  const skippedCount = decisions.filter(item => Boolean(item.skipped_reason)).length
  const latestTick = decisions[0]?.scheduled_for_tick ?? '—'

  const topReason = decisions.reduce<{ reason: string; count: number } | null>((current, decision) => {
    if (!current) {
      return { reason: decision.chosen_reason, count: 1 }
    }

    if (current.reason === decision.chosen_reason) {
      return {
        reason: current.reason,
        count: current.count + 1
      }
    }

    return current
  }, null)

  return [
    {
      id: 'scheduler-total-decisions',
      label: 'Recent Decisions',
      value: String(decisions.length)
    },
    {
      id: 'scheduler-created-count',
      label: 'Created Jobs',
      value: String(createdCount)
    },
    {
      id: 'scheduler-skipped-count',
      label: 'Skipped',
      value: String(skippedCount)
    },
    {
      id: 'scheduler-latest-tick',
      label: 'Latest Tick',
      value: latestTick
    },
    {
      id: 'scheduler-top-reason',
      label: 'Primary Reason',
      value: topReason ? `${topReason.reason} · ${topReason.count}` : '—'
    }
  ]
}
