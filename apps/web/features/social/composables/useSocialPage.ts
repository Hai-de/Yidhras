import { computed, ref, watch } from 'vue'

import { useSocialApi } from '../../../composables/api/useSocialApi'
import { useVisibilityPolling } from '../../../composables/app/useVisibilityPolling'
import { useOperatorNavigation } from '../../shared/navigation'
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

  const items = ref<SocialPostCardViewModel[]>([])
  const isFetching = ref(false)
  const errorMessage = ref<string | null>(null)

  const fetchFeed = async () => {
    isFetching.value = true

    try {
      const snapshot = await socialApi.listFeed({
        authorId: socialRoute.filters.value.authorId,
        circleId: socialRoute.filters.value.circleId,
        keyword: socialRoute.filters.value.keyword,
        sort: socialRoute.filters.value.sort,
        limit: 25
      })
      items.value = snapshot.items.map(toSocialPostCardViewModel)
      errorMessage.value = null
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
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

  const selectPost = (post: SocialPostCardViewModel) => {
    socialRoute.setSelectedPostId(post.id)
  }

  const openAuthor = (agentId: string) => {
    void navigation.goToAgent(agentId, { tab: 'posts' })
  }

  const openWorkflow = (actionIntentId: string) => {
    void navigation.goToWorkflowActionIntent(actionIntentId, 'intent')
  }

  return {
    items,
    selectedPost,
    isFetching,
    errorMessage,
    filters: socialRoute.filters,
    selectedPostId: socialRoute.selectedPostId,
    setFilters: socialRoute.setFilters,
    selectPost,
    openAuthor,
    openWorkflow,
    refresh: fetchFeed
  }
}
