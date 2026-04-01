import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'

import type { OperatorSourcePage } from './navigation'

const normalizeOptionalString = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const normalizeSourcePage = (value: string | null | undefined): OperatorSourcePage | null => {
  switch (value) {
    case 'social':
    case 'timeline':
    case 'graph':
      return value
    default:
      return null
  }
}

export const useOperatorSourceContext = () => {
  const sourcePageQuery = useRouteQuery<string | null>('source_page', null, { mode: 'replace' })
  const sourcePostIdQuery = useRouteQuery<string | null>('source_post_id', null, { mode: 'replace' })
  const sourceEventIdQuery = useRouteQuery<string | null>('source_event_id', null, { mode: 'replace' })
  const sourceRootIdQuery = useRouteQuery<string | null>('source_root_id', null, { mode: 'replace' })
  const sourceNodeIdQuery = useRouteQuery<string | null>('source_node_id', null, { mode: 'replace' })
  const sourceActionIntentIdQuery = useRouteQuery<string | null>('source_action_intent_id', null, {
    mode: 'replace'
  })
  const fromTickQuery = useRouteQuery<string | null>('from_tick', null, { mode: 'replace' })
  const toTickQuery = useRouteQuery<string | null>('to_tick', null, { mode: 'replace' })
  const keywordQuery = useRouteQuery<string | null>('keyword', null, { mode: 'replace' })

  const source = computed(() => ({
    sourcePage: normalizeSourcePage(sourcePageQuery.value),
    sourcePostId: normalizeOptionalString(sourcePostIdQuery.value),
    sourceEventId: normalizeOptionalString(sourceEventIdQuery.value),
    sourceRootId: normalizeOptionalString(sourceRootIdQuery.value),
    sourceNodeId: normalizeOptionalString(sourceNodeIdQuery.value)
  }))

  const hasSource = computed(() => {
    return Boolean(
      source.value.sourcePage ||
        source.value.sourcePostId ||
        source.value.sourceEventId ||
        source.value.sourceRootId ||
        source.value.sourceNodeId
    )
  })

  const summary = computed(() => {
    if (!source.value.sourcePage) {
      return null
    }

    switch (source.value.sourcePage) {
      case 'social':
        return source.value.sourcePostId
          ? `Opened from social post ${source.value.sourcePostId}`
          : 'Opened from social feed'
      case 'timeline':
        return source.value.sourceEventId
          ? `Opened from timeline event ${source.value.sourceEventId}`
          : 'Opened from timeline view'
      case 'graph':
        return source.value.sourceNodeId
          ? `Opened from graph node ${source.value.sourceNodeId}`
          : source.value.sourceRootId
            ? `Opened from graph root ${source.value.sourceRootId}`
            : 'Opened from graph workspace'
      default:
        return null
    }
  })

  const socialSemanticHint = computed(() => {
    const sourceActionIntentId = normalizeOptionalString(sourceActionIntentIdQuery.value)
    const fromTick = normalizeOptionalString(fromTickQuery.value)
    const toTick = normalizeOptionalString(toTickQuery.value)
    const keyword = normalizeOptionalString(keywordQuery.value)

    if (!source.value.sourcePage) {
      return null
    }

    if (source.value.sourcePage === 'timeline') {
      if (sourceActionIntentId) {
        return `Timeline context uses source_action_intent_id ${sourceActionIntentId} to narrow related social posts.`
      }

      if (keyword) {
        return `Timeline context uses semantic keyword search “${keyword}”. This is contextual guidance, not an exact entity mapping.`
      }

      if (fromTick || toTick) {
        return `Timeline context is constrained to tick range ${fromTick ?? '…'} → ${toTick ?? '…'}.`
      }
    }

    if (source.value.sourcePage === 'social' && (fromTick || toTick)) {
      return `Social context opens a related timeline slice at tick range ${fromTick ?? '…'} → ${toTick ?? '…'}, not an exact event id mapping.`
    }

    return null
  })

  return {
    source,
    hasSource,
    summary,
    socialSemanticHint
  }
}
