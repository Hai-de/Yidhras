import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import type { AgentOverviewSnapshot } from '../../../composables/api/useAgentApi'
import { useAgentApi } from '../../../composables/api/useAgentApi'
import { buildAgentProfileFields, buildAgentRelationshipFields } from '../adapters'
import { useAgentRouteState } from '../route'

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown agent detail error'
}

export const useAgentPage = () => {
  const route = useRoute()
  const agentApi = useAgentApi()
  const agentRoute = useAgentRouteState()

  const snapshot = ref<AgentOverviewSnapshot | null>(null)
  const isFetching = ref(false)
  const errorMessage = ref<string | null>(null)

  const fetchOverview = async () => {
    const agentId = typeof route.params.id === 'string' ? route.params.id : null
    if (!agentId) {
      snapshot.value = null
      return
    }

    isFetching.value = true

    try {
      snapshot.value = await agentApi.getOverview(agentId, 10)
      errorMessage.value = null
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      isFetching.value = false
    }
  }

  watch(
    () => route.params.id,
    () => {
      void fetchOverview()
    },
    { immediate: true }
  )

  return {
    snapshot,
    activeTab: agentRoute.activeTab,
    setActiveTab: agentRoute.setActiveTab,
    profileFields: computed(() => (snapshot.value ? buildAgentProfileFields(snapshot.value) : [])),
    relationshipFields: computed(() => (snapshot.value ? buildAgentRelationshipFields(snapshot.value) : [])),
    isFetching,
    errorMessage,
    refresh: fetchOverview
  }
}
