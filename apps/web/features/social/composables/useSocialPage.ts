import { computed, ref, watch } from 'vue'

import { useSocialApi } from '../../../composables/api/useSocialApi'
import { useVisibilityPolling } from '../../../composables/app/useVisibilityPolling'
import { useNotificationsStore } from '../../../stores/notifications'
import { useOperatorNavigation } from '../../shared/navigation'
import { useOperatorSourceContext } from '../../shared/source-context'
import type { SocialPostCardViewModel } from '../adapters'
import { toSocialPostCardViewModel } from '../adapters'
import { useSocialRouteState } from '../route'

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown social feed error'
}

export const useSocialPage = () => {
  const socialApi = useSocialApi()
  const socialRoute = useSocialRouteState()
  const navigation = useOperatorNavigation()
  const sourceContext = useOperatorSourceContext()
  const notifications = useNotificationsStore()

  const items = ref<SocialPostCardViewModel[]>([])
  const isFetching = ref(false)
  const errorMessage = ref<string | null>(null)
  const lastSyncedAt = ref<number | null>(null)

  const fetchFeed = async () => {
    isFetching.value = true

    try {
      const snapshot = await socialApi.listFeed({
        authorId: socialRoute.filters.value.authorId,
        circleId: socialRoute.filters.value.circleId,
        keyword: socialRoute.filters.value.keyword,
        sort: socialRoute.filters.value.sort,
        sourceActionIntentId: socialRoute.filters.value.sourceActionIntentId,
        fromTick: socialRoute.filters.value.fromTick,
        toTick: socialRoute.filters.value.toTick,
        limit: 25
      })
      items.value = snapshot.items.map(toSocialPostCardViewModel)
      errorMessage.value = null
      lastSyncedAt.value = Date.now()
    } catch (error) {
      const message = getErrorMessage(error)
      errorMessage.value = message
      notifications.pushLocalItem({
        level: 'warning',
        content: `Social feed refresh failed: ${message}`,
        code: 'social_refresh_failed'
      })
    } finally {
      isFetching.value = false
    }
  }

  useVisibilityPolling(fetchFeed, {
    visibleIntervalMs: 15000,
    hiddenIntervalMs: 30000,
    immediate: false,
    refreshOnVisible: true
  })

  watch(
    () => socialRoute.filters.value,
    () => {
      void fetchFeed()
    },
    { deep: true, immediate: true }
  )

  const selectedPost = computed(() => {
    if (!socialRoute.selectedPostId.value) {
      return null
    }

    return items.value.find(item => item.id === socialRoute.selectedPostId.value) ?? null
  })

  const mappingHint = computed(() => sourceContext.socialSemanticHint.value)

  const selectPost = (post: SocialPostCardViewModel) => {
    socialRoute.setSelectedPostId(post.id)
  }

  const openAuthor = (agentId: string) => {
    void navigation.goToAgent(agentId, {
      tab: 'posts',
      context: {
        sourcePage: 'social',
        ...(selectedPost.value ? { sourcePostId: selectedPost.value.id } : {})
      }
    })
  }

  const openWorkflow = (actionIntentId: string) => {
    void navigation.goToWorkflowActionIntent(actionIntentId, 'intent', {
      sourcePage: 'social',
      ...(selectedPost.value ? { sourcePostId: selectedPost.value.id } : {})
    })
  }

  const openTimeline = (post: SocialPostCardViewModel) => {
    void navigation.goToTimelineSlice(
      {
        fromTick: post.createdAt,
        toTick: post.createdAt
      },
      {
        sourcePage: 'social',
        sourcePostId: post.id
      }
    )
  }

  const returnToSource = () => {
    if (sourceContext.source.value.sourcePage === 'timeline' && sourceContext.source.value.sourceEventId) {
      void navigation.goToTimelineEvent(sourceContext.source.value.sourceEventId)
      return
    }

    if (sourceContext.source.value.sourcePage === 'graph' && sourceContext.source.value.sourceRootId) {
      void navigation.goToGraphRoot(sourceContext.source.value.sourceRootId, {
        ...(sourceContext.source.value.sourceNodeId
          ? { selectedNodeId: sourceContext.source.value.sourceNodeId }
          : {})
      })
    }
  }

  return {
    items,
    selectedPost,
    isFetching,
    errorMessage,
    lastSyncedAt,
    filters: socialRoute.filters,
    selectedPostId: socialRoute.selectedPostId,
    setFilters: socialRoute.setFilters,
    selectPost,
    openAuthor,
    openWorkflow,
    openTimeline,
    refresh: fetchFeed,
    sourceSummary: sourceContext.summary,
    mappingHint,
    hasSource: sourceContext.hasSource,
    returnToSource
  }
}
