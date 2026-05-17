import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { useRuntimeStore } from '../../../stores/runtime'
import { useShellStore } from '../../../stores/shell'
import { useOperatorSourceContext } from '../../shared/source-context'

export interface ShellQuickActionViewModel {
  id: 'go_overview' | 'return_to_source' | 'open_notifications'
  label: string
  enabled: boolean
}

export interface ShellRecentTargetViewModel {
  id: string
  label: string
  meta: string
  routePath: string
}

export interface ShellContextViewModel {
  workspaceTitle: string
  workspaceSubtitle: string
  sourceSummary: string | null
  focusLabel: string
  focusMeta: string
  quickActions: ShellQuickActionViewModel[]
  recentTargets: ShellRecentTargetViewModel[]
}

const workspaceTitleMap = {
  overview: 'World Overview',
  scheduler: 'Scheduler Control Tower',
  social: 'Social Feed',
  workflow: 'Workflow Inspector',
  timeline: 'Narrative Timeline',
  graph: 'Graph View',
  plugins: 'Plugin Management',
  agents: 'Agent Detail'
} as const

const packPathMatch = (path: string, segment: string): boolean => {
  return new RegExp(`/packs/[^/]+/${segment}`).test(path)
}

export const resolveShellFocusLabel = (path: string): string => {
  if (packPathMatch(path, 'workflow')) {
    return 'Current focus: workflow records'
  }

  if (packPathMatch(path, 'scheduler')) {
    return 'Current focus: scheduler operations'
  }

  if (packPathMatch(path, 'graph')) {
    return 'Current focus: graph projection'
  }

  if (packPathMatch(path, 'social')) {
    return 'Current focus: public signal stream'
  }

  if (packPathMatch(path, 'timeline')) {
    return 'Current focus: narrative event stream'
  }

  if (/\/packs\/[^/]+\/agents/.test(path)) {
    return 'Current focus: agent projection'
  }

  return 'Current focus: operator overview'
}

export const resolveShellFocusMeta = (path: string, search: string): string => {
  if (packPathMatch(path, 'workflow')) {
    return search.includes('job_id=')
      ? 'Focused from workflow job selection.'
      : search.includes('trace_id=')
        ? 'Focused from workflow trace selection.'
        : 'Workflow queue and detail panel are active.'
  }

  if (packPathMatch(path, 'scheduler')) {
    if (search.includes('run_id=')) {
      return 'Scheduler workspace is focused on a specific run.'
    }

    if (search.includes('decision_id=')) {
      return 'Scheduler workspace is focused on a specific decision.'
    }

    if (search.includes('worker_id=')) {
      return 'Scheduler workspace is filtered by worker context.'
    }

    if (search.includes('partition_id=')) {
      return 'Scheduler workspace is filtered by partition context.'
    }

    return 'Scheduler operator projection is active.'
  }

  if (packPathMatch(path, 'graph')) {
    return search.includes('root_id=') ? 'Graph root is pinned via route state.' : 'Graph workspace is using current route filters.'
  }

  if (packPathMatch(path, 'social')) {
    return search.includes('post_id=') ? 'A social post is currently selected.' : 'Social feed filters are active.'
  }

  if (packPathMatch(path, 'timeline')) {
    return search.includes('event_id=') ? 'A timeline event is currently selected.' : 'Timeline slice filters are active.'
  }

  if (/\/packs\/[^/]+\/agents\//.test(path)) {
    return 'Agent detail route is active.'
  }

  return 'Overview aggregates are active.'
}

export const buildShellQuickActions = (input: {
  activeWorkspaceId: keyof typeof workspaceTitleMap
  hasSource: boolean
}): ShellQuickActionViewModel[] => {
  return [
    {
      id: 'go_overview',
      label: 'Go to overview',
      enabled: input.activeWorkspaceId !== 'overview'
    },
    {
      id: 'return_to_source',
      label: 'Return to source',
      enabled: input.hasSource
    },
    {
      id: 'open_notifications',
      label: 'Open notifications dock',
      enabled: true
    }
  ]
}

export const useShellContext = () => {
  const route = useRoute()
  const runtime = useRuntimeStore()
  const shell = useShellStore()
  const sourceContext = useOperatorSourceContext()

  const workspaceTitle = computed(() => {
    return workspaceTitleMap[shell.activeWorkspaceId] ?? 'Operator Workspace'
  })

  const workspaceSubtitle = computed(() => {
    return `${workspaceTitle.value} · ${runtime.worldPack?.name ?? 'world pack pending'}`
  })

  const focusLabel = computed(() => resolveShellFocusLabel(route.path))
  const focusMeta = computed(() => resolveShellFocusMeta(route.path, route.fullPath))

  const quickActions = computed<ShellQuickActionViewModel[]>(() => {
    return buildShellQuickActions({
      activeWorkspaceId: shell.activeWorkspaceId,
      hasSource: sourceContext.hasSource.value
    })
  })

  const recentTargets = computed<ShellRecentTargetViewModel[]>(() => {
    return shell.recentTargets.map(target => ({
      id: target.id,
      label: target.label,
      meta: target.meta,
      routePath: target.routePath
    }))
  })

  return computed<ShellContextViewModel>(() => ({
    workspaceTitle: workspaceTitle.value,
    workspaceSubtitle: workspaceSubtitle.value,
    sourceSummary: sourceContext.summary.value,
    focusLabel: focusLabel.value,
    focusMeta: focusMeta.value,
    quickActions: quickActions.value,
    recentTargets: recentTargets.value
  }))
}
