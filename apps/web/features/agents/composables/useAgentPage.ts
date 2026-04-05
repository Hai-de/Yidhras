import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import type { AgentOverviewSnapshot } from '../../../composables/api/useAgentApi'
import { useAgentApi } from '../../../composables/api/useAgentApi'
import type { AgentSchedulerProjection } from '../../../composables/api/useSchedulerApi'
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
  const schedulerProjection = ref<AgentSchedulerProjection | null>(null)
  const isFetching = ref(false)
  const errorMessage = ref<string | null>(null)

  const fetchOverview = async () => {
    const agentId = typeof route.params.id === 'string' ? route.params.id : null
    if (!agentId) {
      snapshot.value = null
      schedulerProjection.value = null
      return
    }

    isFetching.value = true

    try {
      const [overviewSnapshot, projection] = await Promise.all([
        agentApi.getOverview(agentId, 10),
        schedulerApi.getAgentProjection(agentId, { limit: 20 })
      ])
      snapshot.value = overviewSnapshot
      schedulerProjection.value = projection
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
    const decision = schedulerProjection.value?.timeline.find(item => item.id === decisionId)
    if (!decision) {
      return
    }

    const sourceContextInput = {
      sourcePage: 'agent' as const,
      ...(snapshot.value ? { sourceAgentId: snapshot.value.profile.id } : {}),
      sourceDecisionId: decision.id
    }

    const resolvedJobId = decision.workflow_link?.job_id ?? decision.created_job_id
    if (resolvedJobId) {
      void navigation.goToWorkflowJob(resolvedJobId, sourceContextInput)
      return
    }

    void navigation.goToScheduler({
      decisionId: decision.id,
      runId: decision.scheduler_run_id,
      partitionId: decision.partition_id,
      context: sourceContextInput
    })
  }

  const openSchedulerRun = (runId: string) => {
    void navigation.goToScheduler({
      runId,
      context: {
        sourcePage: 'agent',
        ...(snapshot.value ? { sourceAgentId: snapshot.value.profile.id } : {})
      }
    })
  }

  const openSchedulerJob = (jobId: string) => {
    void navigation.goToWorkflowJob(jobId, {
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
      return
    }

    if (sourceContext.source.value.sourcePage === 'workflow') {
      void navigation.goToWorkflow()
      return
    }

    if (sourceContext.source.value.sourcePage === 'scheduler') {
      void navigation.goToScheduler({
        partitionId: sourceContext.source.value.sourcePartitionId,
        workerId: sourceContext.source.value.sourceWorkerId,
        runId: sourceContext.source.value.sourceRunId,
        decisionId: sourceContext.source.value.sourceDecisionId
      })
      return
    }

    if (sourceContext.source.value.sourcePage === 'overview') {
      void navigation.goToOverview()
    }
  }

  return {
    snapshot,
    schedulerProjection,
    schedulerDecisions: computed(() => schedulerProjection.value?.timeline ?? []),
    schedulerDecisionItems: computed(() => buildAgentSchedulerDecisionItems(schedulerProjection.value?.timeline ?? [])),
    activeTab: agentRoute.activeTab,
    setActiveTab: agentRoute.setActiveTab,
    profileFields: computed(() => (snapshot.value ? buildAgentProfileFields(snapshot.value) : [])),
    relationshipFields: computed(() => (snapshot.value ? buildAgentRelationshipFields(snapshot.value) : [])),
    isFetching,
    errorMessage,
    refresh: fetchOverview,
    openSchedulerDecision,
    openSchedulerRun,
    openSchedulerJob,
    sourceSummary: sourceContext.summary,
    hasSource: sourceContext.hasSource,
    returnToSource
  }
}
