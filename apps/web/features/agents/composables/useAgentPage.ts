import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import type { AgentOverviewSnapshot } from '../../../composables/api/useAgentApi'
import { useAgentApi } from '../../../composables/api/useAgentApi'
import type { SchedulerDecisionItem } from '../../../composables/api/useSchedulerApi'
import { useSchedulerApi } from '../../../composables/api/useSchedulerApi'
import { useOperatorNavigation } from '../../shared/navigation'
import { useOperatorSourceContext } from '../../shared/source-context'
import {
  buildAgentProfileFields,
  buildAgentRelationshipFields,
  buildAgentSchedulerDecisionItems
} from '../adapters'
import { useAgentRouteState } from '../route'

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : 'Unknown agent detail error'
}

export const useAgentPage = () => {
  const route = useRoute()
  const agentApi = useAgentApi()
  const schedulerApi = useSchedulerApi()
  const agentRoute = useAgentRouteState()
  const navigation = useOperatorNavigation()
  const sourceContext = useOperatorSourceContext()

  const snapshot = ref<AgentOverviewSnapshot | null>(null)
  const schedulerDecisions = ref<SchedulerDecisionItem[]>([])
  const isFetching = ref(false)
  const errorMessage = ref<string | null>(null)

  const fetchOverview = async () => {
    const agentId = typeof route.params.id === 'string' ? route.params.id : null
    if (!agentId) {
      snapshot.value = null
      schedulerDecisions.value = []
      return
    }

    isFetching.value = true

    try {
      const [overviewSnapshot, decisionItems] = await Promise.all([
        agentApi.getOverview(agentId, 10),
        schedulerApi.listAgentDecisions(agentId)
      ])
      snapshot.value = overviewSnapshot
      schedulerDecisions.value = decisionItems
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

  const openSchedulerDecision = (decisionId: string) => {
    const decision = schedulerDecisions.value.find(item => item.id === decisionId)
    if (!decision) {
      return
    }

    if (decision.created_job_id) {
      void navigation.goToWorkflowJob(decision.created_job_id, {
        sourcePage: 'agent',
        ...(snapshot.value ? { sourceAgentId: snapshot.value.profile.id } : {})
      })
      return
    }

    void navigation.goToWorkflowWithSchedulerRun(decisionId, {
      sourcePage: 'agent',
      ...(snapshot.value ? { sourceAgentId: snapshot.value.profile.id } : {})
    })
  }

  const returnToSource = () => {
    if (sourceContext.source.value.sourcePage === 'social' && sourceContext.source.value.sourcePostId) {
      void navigation.goToSocialPost(sourceContext.source.value.sourcePostId)
      return
    }

    if (sourceContext.source.value.sourcePage === 'graph' && sourceContext.source.value.sourceRootId) {
      void navigation.goToGraphRoot(sourceContext.source.value.sourceRootId, {
        ...(sourceContext.source.value.sourceNodeId
          ? { selectedNodeId: sourceContext.source.value.sourceNodeId }
          : {})
      })
      return
    }

    if (sourceContext.source.value.sourcePage === 'timeline' && sourceContext.source.value.sourceEventId) {
      void navigation.goToTimelineEvent(sourceContext.source.value.sourceEventId)
    }
  }

  return {
    snapshot,
    schedulerDecisions,
    schedulerDecisionItems: computed(() => buildAgentSchedulerDecisionItems(schedulerDecisions.value)),
    activeTab: agentRoute.activeTab,
    setActiveTab: agentRoute.setActiveTab,
    profileFields: computed(() => (snapshot.value ? buildAgentProfileFields(snapshot.value) : [])),
    relationshipFields: computed(() => (snapshot.value ? buildAgentRelationshipFields(snapshot.value) : [])),
    isFetching,
    errorMessage,
    refresh: fetchOverview,
    openSchedulerDecision,
    sourceSummary: sourceContext.summary,
    hasSource: sourceContext.hasSource,
    returnToSource
  }
}
