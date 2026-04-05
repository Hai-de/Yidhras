import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'

import { normalizeOptionalString } from '../../lib/route/query'
import type { OperatorSourcePage } from './navigation'

export interface OperatorSourceSnapshot {
  sourcePage: OperatorSourcePage | null
  sourcePostId: string | null
  sourceEventId: string | null
  sourceRootId: string | null
  sourceNodeId: string | null
  sourceRunId: string | null
  sourceDecisionId: string | null
  sourceAgentId: string | null
  sourcePartitionId: string | null
  sourceWorkerId: string | null
}

export const normalizeSourcePage = (value: string | null | undefined): OperatorSourcePage | null => {
  switch (value) {
    case 'social':
    case 'timeline':
    case 'graph':
    case 'overview':
    case 'workflow':
    case 'agent':
    case 'scheduler':
      return value
    default:
      return null
  }
}

export const buildSourceSummary = (source: OperatorSourceSnapshot): string | null => {
  if (!source.sourcePage) {
    return null
  }

  switch (source.sourcePage) {
    case 'social':
      return source.sourcePostId ? `Opened from social post ${source.sourcePostId}` : 'Opened from social feed'
    case 'timeline':
      return source.sourceEventId ? `Opened from timeline event ${source.sourceEventId}` : 'Opened from timeline view'
    case 'graph':
      if (source.sourceNodeId) {
        return `Opened from graph node ${source.sourceNodeId}`
      }
      if (source.sourceRootId) {
        return `Opened from graph root ${source.sourceRootId}`
      }
      return 'Opened from graph workspace'
    case 'overview':
      if (source.sourceDecisionId) {
        return `Opened from overview scheduler decision ${source.sourceDecisionId}`
      }
      if (source.sourceRunId) {
        return `Opened from overview scheduler run ${source.sourceRunId}`
      }
      return 'Opened from overview workspace'
    case 'workflow':
      if (source.sourceDecisionId) {
        return `Opened from workflow scheduler decision ${source.sourceDecisionId}`
      }
      if (source.sourceRunId) {
        return `Opened from workflow scheduler run ${source.sourceRunId}`
      }
      return 'Opened from workflow console'
    case 'agent':
      return source.sourceAgentId ? `Opened from agent ${source.sourceAgentId}` : 'Opened from agent workspace'
    case 'scheduler':
      if (source.sourceDecisionId) {
        return `Opened from scheduler decision ${source.sourceDecisionId}`
      }
      if (source.sourceRunId) {
        return `Opened from scheduler run ${source.sourceRunId}`
      }
      if (source.sourcePartitionId) {
        return `Opened from scheduler partition ${source.sourcePartitionId}`
      }
      if (source.sourceWorkerId) {
        return `Opened from scheduler worker ${source.sourceWorkerId}`
      }
      return 'Opened from scheduler workspace'
    default:
      return null
  }
}

export const buildSocialSemanticHint = (
  source: OperatorSourceSnapshot,
  input: {
    sourceActionIntentId: string | null
    fromTick: string | null
    toTick: string | null
    keyword: string | null
  }
): string | null => {
  if (!source.sourcePage) {
    return null
  }

  if (source.sourcePage === 'timeline') {
    if (input.sourceActionIntentId) {
      return `Timeline context uses source_action_intent_id ${input.sourceActionIntentId} to narrow related social posts.`
    }

    if (input.keyword) {
      return `Timeline context uses semantic keyword search “${input.keyword}”. This is contextual guidance, not an exact entity mapping.`
    }

    if (input.fromTick || input.toTick) {
      return `Timeline context is constrained to tick range ${input.fromTick ?? '…'} → ${input.toTick ?? '…'}.`
    }
  }

  if (source.sourcePage === 'social' && (input.fromTick || input.toTick)) {
    return `Social context opens a related timeline slice at tick range ${input.fromTick ?? '…'} → ${input.toTick ?? '…'}, not an exact event id mapping.`
  }

  return null
}

export const useOperatorSourceContext = () => {
  const sourcePageQuery = useRouteQuery<string | null>('source_page', null, { mode: 'replace' })
  const sourcePostIdQuery = useRouteQuery<string | null>('source_post_id', null, { mode: 'replace' })
  const sourceEventIdQuery = useRouteQuery<string | null>('source_event_id', null, { mode: 'replace' })
  const sourceRootIdQuery = useRouteQuery<string | null>('source_root_id', null, { mode: 'replace' })
  const sourceNodeIdQuery = useRouteQuery<string | null>('source_node_id', null, { mode: 'replace' })
  const sourceRunIdQuery = useRouteQuery<string | null>('source_run_id', null, { mode: 'replace' })
  const sourceDecisionIdQuery = useRouteQuery<string | null>('source_decision_id', null, { mode: 'replace' })
  const sourceAgentIdQuery = useRouteQuery<string | null>('source_agent_id', null, { mode: 'replace' })
  const sourcePartitionIdQuery = useRouteQuery<string | null>('source_partition_id', null, { mode: 'replace' })
  const sourceWorkerIdQuery = useRouteQuery<string | null>('source_worker_id', null, { mode: 'replace' })
  const sourceActionIntentIdQuery = useRouteQuery<string | null>('source_action_intent_id', null, {
    mode: 'replace'
  })
  const fromTickQuery = useRouteQuery<string | null>('from_tick', null, { mode: 'replace' })
  const toTickQuery = useRouteQuery<string | null>('to_tick', null, { mode: 'replace' })
  const keywordQuery = useRouteQuery<string | null>('keyword', null, { mode: 'replace' })

  const source = computed<OperatorSourceSnapshot>(() => ({
    sourcePage: normalizeSourcePage(sourcePageQuery.value),
    sourcePostId: normalizeOptionalString(sourcePostIdQuery.value),
    sourceEventId: normalizeOptionalString(sourceEventIdQuery.value),
    sourceRootId: normalizeOptionalString(sourceRootIdQuery.value),
    sourceNodeId: normalizeOptionalString(sourceNodeIdQuery.value),
    sourceRunId: normalizeOptionalString(sourceRunIdQuery.value),
    sourceDecisionId: normalizeOptionalString(sourceDecisionIdQuery.value),
    sourceAgentId: normalizeOptionalString(sourceAgentIdQuery.value),
    sourcePartitionId: normalizeOptionalString(sourcePartitionIdQuery.value),
    sourceWorkerId: normalizeOptionalString(sourceWorkerIdQuery.value)
  }))

  const hasSource = computed(() => {
    return Boolean(
      source.value.sourcePage ||
        source.value.sourcePostId ||
        source.value.sourceEventId ||
        source.value.sourceRootId ||
        source.value.sourceNodeId ||
        source.value.sourceRunId ||
        source.value.sourceDecisionId ||
        source.value.sourceAgentId ||
        source.value.sourcePartitionId ||
        source.value.sourceWorkerId
    )
  })

  const summary = computed(() => buildSourceSummary(source.value))

  const socialSemanticHint = computed(() => {
    return buildSocialSemanticHint(source.value, {
      sourceActionIntentId: normalizeOptionalString(sourceActionIntentIdQuery.value),
      fromTick: normalizeOptionalString(fromTickQuery.value),
      toTick: normalizeOptionalString(toTickQuery.value),
      keyword: normalizeOptionalString(keywordQuery.value)
    })
  })

  return {
    source,
    hasSource,
    summary,
    socialSemanticHint
  }
}
