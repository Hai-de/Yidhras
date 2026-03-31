import { useRouter } from 'vue-router'

export const useOperatorNavigation = () => {
  const router = useRouter()

  return {
    goToOverview: () => router.push('/overview'),
    goToWorkflowJob: (jobId: string) => router.push({ path: '/workflow', query: { job_id: jobId } }),
    goToWorkflowTrace: (traceId: string, tab?: 'trace' | 'intent') =>
      router.push({
        path: '/workflow',
        query: {
          trace_id: traceId,
          ...(tab ? { tab } : {})
        }
      }),
    goToWorkflowActionIntent: (actionIntentId: string, tab?: 'intent' | 'workflow') =>
      router.push({
        path: '/workflow',
        query: {
          action_intent_id: actionIntentId,
          ...(tab ? { tab } : {})
        }
      }),
    goToSocialPost: (postId: string) => router.push({ path: '/social', query: { post_id: postId } }),
    goToTimelineEvent: (eventId: string) => router.push({ path: '/timeline', query: { event_id: eventId } }),
    goToGraphRoot: (rootId: string, options?: { view?: 'mesh' | 'tree'; selectedNodeId?: string }) =>
      router.push({
        path: '/graph',
        query: {
          root_id: rootId,
          ...(options?.view && options.view !== 'mesh' ? { view: options.view } : {}),
          ...(options?.selectedNodeId ? { selected_node_id: options.selectedNodeId } : {})
        }
      }),
    goToAgent: (agentId: string, options?: { tab?: 'overview' | 'relations' | 'posts' | 'workflows' | 'memory' }) =>
      router.push({
        path: `/agents/${agentId}`,
        query: {
          ...(options?.tab && options.tab !== 'overview' ? { tab: options.tab } : {})
        }
      })
  }
}
