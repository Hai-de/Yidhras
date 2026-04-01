import { useRouter } from 'vue-router'

export type OperatorSourcePage = 'social' | 'timeline' | 'graph' | 'overview' | 'workflow' | 'agent'

export interface OperatorNavigationSourceContext {
  sourcePage: OperatorSourcePage
  sourcePostId?: string
  sourceEventId?: string
  sourceRootId?: string
  sourceNodeId?: string
  sourceRunId?: string
  sourceDecisionId?: string
  sourceAgentId?: string
}

export interface SocialFeedNavigationOptions {
  keyword?: string | null
  sourceActionIntentId?: string | null
  fromTick?: string | null
  toTick?: string | null
  context?: OperatorNavigationSourceContext
}

const buildSourceQuery = (context?: OperatorNavigationSourceContext) => {
  if (!context) {
    return {}
  }

  return {
    source_page: context.sourcePage,
    ...(context.sourcePostId ? { source_post_id: context.sourcePostId } : {}),
    ...(context.sourceEventId ? { source_event_id: context.sourceEventId } : {}),
    ...(context.sourceRootId ? { source_root_id: context.sourceRootId } : {}),
    ...(context.sourceNodeId ? { source_node_id: context.sourceNodeId } : {}),
    ...(context.sourceRunId ? { source_run_id: context.sourceRunId } : {}),
    ...(context.sourceDecisionId ? { source_decision_id: context.sourceDecisionId } : {}),
    ...(context.sourceAgentId ? { source_agent_id: context.sourceAgentId } : {})
  }
}

export const useOperatorNavigation = () => {
  const router = useRouter()

  return {
    goToOverview: () => router.push('/overview'),
    goToWorkflowJob: (jobId: string, context?: OperatorNavigationSourceContext) =>
      router.push({
        path: '/workflow',
        query: {
          job_id: jobId,
          ...buildSourceQuery(context)
        }
      }),
    goToWorkflowTrace: (
      traceId: string,
      tab?: 'trace' | 'intent',
      context?: OperatorNavigationSourceContext
    ) =>
      router.push({
        path: '/workflow',
        query: {
          trace_id: traceId,
          ...(tab ? { tab } : {}),
          ...buildSourceQuery(context)
        }
      }),
    goToWorkflowActionIntent: (
      actionIntentId: string,
      tab?: 'intent' | 'workflow',
      context?: OperatorNavigationSourceContext
    ) =>
      router.push({
        path: '/workflow',
        query: {
          action_intent_id: actionIntentId,
          ...(tab ? { tab } : {}),
          ...buildSourceQuery(context)
        }
      }),
    goToWorkflowWithSchedulerRun: (runId: string, context?: OperatorNavigationSourceContext) =>
      router.push({
        path: '/workflow',
        query: {
          scheduler_run_id: runId,
          ...buildSourceQuery(context)
        }
      }),
    goToSocialFeed: (options?: SocialFeedNavigationOptions) =>
      router.push({
        path: '/social',
        query: {
          ...(options?.keyword ? { keyword: options.keyword } : {}),
          ...(options?.sourceActionIntentId ? { source_action_intent_id: options.sourceActionIntentId } : {}),
          ...(options?.fromTick ? { from_tick: options.fromTick } : {}),
          ...(options?.toTick ? { to_tick: options.toTick } : {}),
          ...buildSourceQuery(options?.context)
        }
      }),
    goToSocialPost: (postId: string, context?: OperatorNavigationSourceContext) =>
      router.push({
        path: '/social',
        query: {
          post_id: postId,
          ...buildSourceQuery(context)
        }
      }),
    goToTimelineEvent: (eventId: string, context?: OperatorNavigationSourceContext) =>
      router.push({
        path: '/timeline',
        query: {
          event_id: eventId,
          ...buildSourceQuery(context)
        }
      }),
    goToTimelineSlice: (
      options: {
        fromTick?: string | null
        toTick?: string | null
      },
      context?: OperatorNavigationSourceContext
    ) =>
      router.push({
        path: '/timeline',
        query: {
          ...(options.fromTick ? { from_tick: options.fromTick } : {}),
          ...(options.toTick ? { to_tick: options.toTick } : {}),
          ...buildSourceQuery(context)
        }
      }),
    goToGraphRoot: (
      rootId: string,
      options?: {
        view?: 'mesh' | 'tree'
        selectedNodeId?: string
        context?: OperatorNavigationSourceContext
      }
    ) =>
      router.push({
        path: '/graph',
        query: {
          root_id: rootId,
          ...(options?.view && options.view !== 'mesh' ? { view: options.view } : {}),
          ...(options?.selectedNodeId ? { selected_node_id: options.selectedNodeId } : {}),
          ...buildSourceQuery(options?.context)
        }
      }),
    goToAgent: (
      agentId: string,
      options?: {
        tab?: 'overview' | 'relations' | 'posts' | 'workflows' | 'memory'
        context?: OperatorNavigationSourceContext
      }
    ) =>
      router.push({
        path: `/agents/${agentId}`,
        query: {
          ...(options?.tab && options.tab !== 'overview' ? { tab: options.tab } : {}),
          ...buildSourceQuery(options?.context)
        }
      })
  }
}
