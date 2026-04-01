import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'

const normalizeOptionalString = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const normalizeSocialSort = (value: string | null | undefined): 'latest' | 'signal' => {
  return value === 'signal' ? 'signal' : 'latest'
}

export const useSocialRouteState = () => {
  const postIdQuery = useRouteQuery<string | null>('post_id', null, { mode: 'replace' })
  const authorIdQuery = useRouteQuery<string | null>('author_id', null, { mode: 'replace' })
  const circleIdQuery = useRouteQuery<string | null>('circle_id', null, { mode: 'replace' })
  const keywordQuery = useRouteQuery<string | null>('keyword', null, { mode: 'replace' })
  const sourceActionIntentIdQuery = useRouteQuery<string | null>('source_action_intent_id', null, { mode: 'replace' })
  const fromTickQuery = useRouteQuery<string | null>('from_tick', null, { mode: 'replace' })
  const toTickQuery = useRouteQuery<string | null>('to_tick', null, { mode: 'replace' })
  const sortQuery = useRouteQuery<string | null>('sort', 'latest', { mode: 'replace' })

  const selectedPostId = computed(() => normalizeOptionalString(postIdQuery.value))
  const filters = computed<{
    authorId: string | null
    circleId: string | null
    keyword: string | null
    sourceActionIntentId: string | null
    fromTick: string | null
    toTick: string | null
    sort: 'latest' | 'signal'
  }>(() => ({
    authorId: normalizeOptionalString(authorIdQuery.value),
    circleId: normalizeOptionalString(circleIdQuery.value),
    keyword: normalizeOptionalString(keywordQuery.value),
    sourceActionIntentId: normalizeOptionalString(sourceActionIntentIdQuery.value),
    fromTick: normalizeOptionalString(fromTickQuery.value),
    toTick: normalizeOptionalString(toTickQuery.value),
    sort: normalizeSocialSort(sortQuery.value)
  }))

  const setSelectedPostId = (postId: string | null) => {
    postIdQuery.value = normalizeOptionalString(postId)
  }

  const setFilters = (nextFilters: {
    authorId?: string | null
    circleId?: string | null
    keyword?: string | null
    sourceActionIntentId?: string | null
    fromTick?: string | null
    toTick?: string | null
    sort?: 'latest' | 'signal'
  }) => {
    if ('authorId' in nextFilters) {
      authorIdQuery.value = normalizeOptionalString(nextFilters.authorId ?? null)
    }

    if ('circleId' in nextFilters) {
      circleIdQuery.value = normalizeOptionalString(nextFilters.circleId ?? null)
    }

    if ('keyword' in nextFilters) {
      keywordQuery.value = normalizeOptionalString(nextFilters.keyword ?? null)
    }

    if ('sourceActionIntentId' in nextFilters) {
      sourceActionIntentIdQuery.value = normalizeOptionalString(nextFilters.sourceActionIntentId ?? null)
    }

    if ('fromTick' in nextFilters) {
      fromTickQuery.value = normalizeOptionalString(nextFilters.fromTick ?? null)
    }

    if ('toTick' in nextFilters) {
      toTickQuery.value = normalizeOptionalString(nextFilters.toTick ?? null)
    }

    if (nextFilters.sort) {
      sortQuery.value = nextFilters.sort === 'latest' ? null : nextFilters.sort
    }
  }

  return {
    selectedPostId,
    filters,
    setSelectedPostId,
    setFilters
  }
}
