import type { AgentOverviewSnapshot } from '../../composables/api/useAgentApi'

export interface AgentSectionField {
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
