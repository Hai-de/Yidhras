<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useNotificationsStore } from '../../../stores/notifications'
import { useRuntimeStore } from '../../../stores/runtime'
import type { DockTabId, OperatorWorkspaceId } from '../../../stores/shell'
import { useShellStore } from '../../../stores/shell'
import { useOperatorSourceContext } from '../../shared/source-context'
import { useShellContext } from '../composables/useShellContext'
import ActivityRail from './ActivityRail.vue'
import BottomDock from './BottomDock.vue'
import ShellSettingsMenu from './ShellSettingsMenu.vue'
import StatusBar from './StatusBar.vue'
import TopRuntimeBar from './TopRuntimeBar.vue'
import WorkspaceSidebar from './WorkspaceSidebar.vue'

const router = useRouter()
const route = useRoute()
const runtime = useRuntimeStore()
const notifications = useNotificationsStore()
const shell = useShellStore()
const shellContext = useShellContext()
const sourceContext = useOperatorSourceContext()
const isSettingsOpen = ref(false)

const DEFAULT_DOCK_HEIGHT = 224
const DEFAULT_DOCK_MAX_HEIGHT = 480
const MIN_DOCK_HEIGHT = 160
const MIN_MAIN_HEIGHT = 160
const SETTINGS_MENU_WIDTH = 288
const SETTINGS_MENU_MARGIN = 12
const STATUS_BAR_HEIGHT = 32

const dockSplitRef = useTemplateRef<HTMLElement>('dockSplit')
const availableDockHeight = ref(DEFAULT_DOCK_HEIGHT)
const settingsMenuStyle = ref<Record<string, string>>({
  left: `${SETTINGS_MENU_MARGIN}px`,
  bottom: `${STATUS_BAR_HEIGHT + SETTINGS_MENU_MARGIN}px`
})
let dockResizeObserver: ResizeObserver | null = null

const isHtmlElement = (value: EventTarget | null): value is HTMLElement => {
  return value instanceof HTMLElement
}

const resolveLayoutLength = (variableName: string, fallback: number): number => {
  if (typeof window === 'undefined') {
    return fallback
  }

  const rawValue = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim()
  const parsedValue = Number.parseFloat(rawValue)
  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

const resolvedDockDefaultHeight = computed(() => {
  return resolveLayoutLength('--yd-layout-shell-dock-default-height', DEFAULT_DOCK_HEIGHT)
})

const resolvedDockMinHeight = computed(() => {
  return resolveLayoutLength('--yd-layout-shell-dock-min-height', MIN_DOCK_HEIGHT)
})

const resolvedDockMaxHeight = computed(() => {
  return resolveLayoutLength('--yd-layout-shell-dock-max-height', DEFAULT_DOCK_MAX_HEIGHT)
})

const updateAvailableDockHeight = () => {
  if (!dockSplitRef.value) {
    availableDockHeight.value = resolvedDockDefaultHeight.value
    return
  }

  const splitHeight = dockSplitRef.value.clientHeight
  const nextMaxHeight = Math.max(
    Math.min(splitHeight - MIN_MAIN_HEIGHT, resolvedDockMaxHeight.value),
    resolvedDockMinHeight.value
  )

  availableDockHeight.value = nextMaxHeight

  if (shell.dockHeight > nextMaxHeight) {
    shell.setDockHeight(nextMaxHeight)
  }
}

const clampedDockHeight = computed(() => {
  return Math.min(Math.max(shell.dockHeight, resolvedDockMinHeight.value), availableDockHeight.value)
})

const dockSplitStyle = computed(() => {
  return {
    gridTemplateRows: shell.isDockExpanded ? `minmax(0, 1fr) ${clampedDockHeight.value}px` : 'minmax(0, 1fr) 0px'
  }
})

const shellFrameStyle = {
  gridTemplateColumns: 'var(--yd-layout-shell-rail-width) var(--yd-layout-shell-sidebar-width) minmax(0, 1fr)',
  gridTemplateRows: 'minmax(0, 1fr) auto'
} as const

const mainColumnStyle = {
  gridTemplateRows: 'auto minmax(0, 1fr)'
} as const

const statusBarContentOffset =
  'calc(var(--yd-layout-shell-rail-width) + var(--yd-layout-shell-sidebar-width))' as const

const updateSettingsMenuPosition = (event?: MouseEvent) => {
  const currentTarget = event?.currentTarget ?? null

  if (typeof window === 'undefined' || !isHtmlElement(currentTarget)) {
    settingsMenuStyle.value = {
      left: `${SETTINGS_MENU_MARGIN}px`,
      bottom: `${STATUS_BAR_HEIGHT + SETTINGS_MENU_MARGIN}px`
    }
    return
  }

  const targetRect = currentTarget.getBoundingClientRect()
  const nextLeft = Math.max(
    SETTINGS_MENU_MARGIN,
    Math.min(targetRect.left, window.innerWidth - SETTINGS_MENU_WIDTH - SETTINGS_MENU_MARGIN)
  )
  const nextBottom = Math.max(STATUS_BAR_HEIGHT + SETTINGS_MENU_MARGIN, window.innerHeight - targetRect.top + 8)

  settingsMenuStyle.value = {
    left: `${nextLeft}px`,
    bottom: `${nextBottom}px`
  }
}

const handleWindowResize = () => {
  updateAvailableDockHeight()

  if (isSettingsOpen.value) {
    isSettingsOpen.value = false
  }
}

const handleGlobalPointerDown = (event: PointerEvent) => {
  if (!isSettingsOpen.value || !isHtmlElement(event.target)) {
    return
  }

  if (
    event.target.closest('.yd-shell-settings-menu') ||
    event.target.closest('[data-yd-shell-settings-trigger="true"]')
  ) {
    return
  }

  isSettingsOpen.value = false
}

const handleGlobalKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    isSettingsOpen.value = false
  }
}

onMounted(async () => {
  await nextTick()
  updateAvailableDockHeight()

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleWindowResize)
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', handleGlobalPointerDown)
    document.addEventListener('keydown', handleGlobalKeydown)
  }

  if (typeof ResizeObserver !== 'undefined' && dockSplitRef.value) {
    dockResizeObserver = new ResizeObserver(() => {
      updateAvailableDockHeight()
    })
    dockResizeObserver.observe(dockSplitRef.value)
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleWindowResize)
  }

  if (typeof document !== 'undefined') {
    document.removeEventListener('pointerdown', handleGlobalPointerDown)
    document.removeEventListener('keydown', handleGlobalKeydown)
  }

  dockResizeObserver?.disconnect()
  dockResizeObserver = null
})

watch(
  () => shell.isDockExpanded,
  async () => {
    await nextTick()
    updateAvailableDockHeight()
  }
)

watch(
  () => resolvedDockDefaultHeight.value,
  nextDefaultHeight => {
    availableDockHeight.value = nextDefaultHeight
  },
  { immediate: true }
)

const activityItems = [
  { id: 'overview', label: 'World Overview', shortLabel: 'OV' },
  { id: 'scheduler', label: 'Scheduler Workspace', shortLabel: 'SC' },
  { id: 'social', label: 'Social Feed', shortLabel: 'SO' },
  { id: 'workflow', label: 'Workflow Inspector', shortLabel: 'WF' },
  { id: 'timeline', label: 'Narrative Timeline', shortLabel: 'TL' },
  { id: 'graph', label: 'Graph View', shortLabel: 'GR' },
  { id: 'agents', label: 'Agent Detail', shortLabel: 'AG' }
] as const satisfies ReadonlyArray<{
  id: OperatorWorkspaceId
  label: string
  shortLabel: string
}>

const panelTabs = [
  { id: 'traces', label: 'Decision Traces', shortLabel: 'TR' },
  { id: 'jobs', label: 'Jobs', shortLabel: 'JB' },
  { id: 'notifications', label: 'Notifications', shortLabel: 'NT' }
] as const satisfies ReadonlyArray<{
  id: DockTabId
  label: string
  shortLabel: string
}>

const resolveWorkspaceIdFromPath = (path: string): OperatorWorkspaceId => {
  if (path.startsWith('/scheduler')) return 'scheduler'
  if (path.startsWith('/social')) return 'social'
  if (path.startsWith('/workflow')) return 'workflow'
  if (path.startsWith('/timeline')) return 'timeline'
  if (path.startsWith('/graph')) return 'graph'
  if (path.startsWith('/agents')) return 'agents'
  return 'overview'
}

const recordRecentTargetForRoute = (path: string, fullPath: string) => {
  if (path.startsWith('/workflow') && route.query.job_id && typeof route.query.job_id === 'string') {
    shell.recordRecentTarget({
      id: `workflow:${route.query.job_id}`,
      label: `Workflow job ${route.query.job_id}`,
      meta: 'workflow selection',
      workspaceId: 'workflow',
      routePath: fullPath
    })
    return
  }

  if (path.startsWith('/scheduler') && route.query.run_id && typeof route.query.run_id === 'string') {
    shell.recordRecentTarget({
      id: `scheduler-run:${route.query.run_id}`,
      label: `Scheduler run ${route.query.run_id}`,
      meta: 'scheduler run focus',
      workspaceId: 'scheduler',
      routePath: fullPath
    })
    return
  }

  if (path.startsWith('/scheduler') && route.query.decision_id && typeof route.query.decision_id === 'string') {
    shell.recordRecentTarget({
      id: `scheduler-decision:${route.query.decision_id}`,
      label: `Scheduler decision ${route.query.decision_id}`,
      meta: 'scheduler decision focus',
      workspaceId: 'scheduler',
      routePath: fullPath
    })
    return
  }

  if (path.startsWith('/scheduler') && route.query.worker_id && typeof route.query.worker_id === 'string') {
    shell.recordRecentTarget({
      id: `scheduler-worker:${route.query.worker_id}`,
      label: `Scheduler worker ${route.query.worker_id}`,
      meta: 'scheduler worker filter',
      workspaceId: 'scheduler',
      routePath: fullPath
    })
    return
  }

  if (path.startsWith('/scheduler') && route.query.partition_id && typeof route.query.partition_id === 'string') {
    shell.recordRecentTarget({
      id: `scheduler-partition:${route.query.partition_id}`,
      label: `Scheduler partition ${route.query.partition_id}`,
      meta: 'scheduler partition filter',
      workspaceId: 'scheduler',
      routePath: fullPath
    })
    return
  }

  if (path.startsWith('/social') && route.query.post_id && typeof route.query.post_id === 'string') {
    shell.recordRecentTarget({
      id: `social:${route.query.post_id}`,
      label: `Social post ${route.query.post_id}`,
      meta: 'social selection',
      workspaceId: 'social',
      routePath: fullPath
    })
    return
  }

  if (path.startsWith('/graph') && route.query.root_id && typeof route.query.root_id === 'string') {
    shell.recordRecentTarget({
      id: `graph:${route.query.root_id}`,
      label: `Graph root ${route.query.root_id}`,
      meta: 'graph focus',
      workspaceId: 'graph',
      routePath: fullPath
    })
    return
  }

  if (path.startsWith('/agents/') && typeof route.params.id === 'string') {
    shell.recordRecentTarget({
      id: `agent:${route.params.id}`,
      label: `Agent ${route.params.id}`,
      meta: 'agent detail',
      workspaceId: 'agents',
      routePath: fullPath
    })
  }
}

watch(
  () => route.path,
  path => {
    shell.setActiveWorkspace(resolveWorkspaceIdFromPath(path))
    isSettingsOpen.value = false
  },
  { immediate: true }
)

watch(
  () => route.fullPath,
  fullPath => {
    recordRecentTargetForRoute(route.path, fullPath)
  },
  { immediate: true }
)

const workspaceTitle = computed(() => shellContext.value.workspaceTitle)
const workspaceSubtitle = computed(() => shellContext.value.workspaceSubtitle)

const shellClockPanelTitle = computed(() => {
  return runtime.primaryCalendarTime
})

const shellClockPanelSubtitle = computed(() => {
  return `Tick ${runtime.formattedTicks} · ${runtime.statusFreshnessLabel}`
})

const traceTargets = computed(() => {
  return shellContext.value.recentTargets.filter(target => target.id.startsWith('workflow:')).slice(0, 4)
})

const jobTargets = computed(() => {
  return shellContext.value.recentTargets
    .filter(target =>
      target.id.startsWith('workflow:') ||
      target.id.startsWith('agent:') ||
      target.id.startsWith('scheduler-run:') ||
      target.id.startsWith('scheduler-decision:')
    )
    .slice(0, 4)
})

const dockTargets = computed(() => {
  if (shell.activeDockTabId === 'traces') {
    return traceTargets.value
  }

  if (shell.activeDockTabId === 'jobs') {
    return jobTargets.value
  }

  return []
})

const dockLabel = computed(() => {
  if (shell.activeDockTabId === 'traces') {
    return 'Decision traces'
  }

  if (shell.activeDockTabId === 'jobs') {
    return 'Jobs'
  }

  return 'Notifications'
})

const dockEmptyMessage = computed(() => {
  if (shell.activeDockTabId === 'traces') {
    return 'Recent workflow trace pivots will appear here once scheduler and workflow selections are recorded.'
  }

  if (shell.activeDockTabId === 'jobs') {
    return 'Recent workflow jobs, scheduler runs, and agent pivots will appear here for quick reopening.'
  }

  return 'No notifications have been recorded yet.'
})

const isOperatorWorkspaceId = (value: string): value is OperatorWorkspaceId => {
  return activityItems.some(item => item.id === value)
}

const handleWorkspaceSelect = async (workspaceId: string) => {
  if (!isOperatorWorkspaceId(workspaceId)) return
  shell.setActiveWorkspace(workspaceId)

  if (workspaceId === 'agents') {
    await router.push('/agents')
    return
  }

  await router.push(`/${workspaceId}`)
}

const handleReturnToSource = async () => {
  if (sourceContext.source.value.sourcePage === 'social' && sourceContext.source.value.sourcePostId) {
    await router.push({
      path: '/social',
      query: {
        post_id: sourceContext.source.value.sourcePostId
      }
    })
    return
  }

  if (sourceContext.source.value.sourcePage === 'timeline' && sourceContext.source.value.sourceEventId) {
    await router.push({
      path: '/timeline',
      query: {
        event_id: sourceContext.source.value.sourceEventId
      }
    })
    return
  }

  if (sourceContext.source.value.sourcePage === 'graph' && sourceContext.source.value.sourceRootId) {
    await router.push({
      path: '/graph',
      query: {
        root_id: sourceContext.source.value.sourceRootId,
        ...(sourceContext.source.value.sourceNodeId
          ? { selected_node_id: sourceContext.source.value.sourceNodeId }
          : {})
      }
    })
    return
  }

  if (sourceContext.source.value.sourcePage === 'agent' && sourceContext.source.value.sourceAgentId) {
    await router.push(`/agents/${sourceContext.source.value.sourceAgentId}`)
    return
  }

  if (sourceContext.source.value.sourcePage === 'scheduler') {
    await router.push({
      path: '/scheduler',
      query: {
        ...(sourceContext.source.value.sourceRunId ? { run_id: sourceContext.source.value.sourceRunId } : {}),
        ...(sourceContext.source.value.sourceDecisionId ? { decision_id: sourceContext.source.value.sourceDecisionId } : {}),
        ...(sourceContext.source.value.sourcePartitionId ? { partition_id: sourceContext.source.value.sourcePartitionId } : {}),
        ...(sourceContext.source.value.sourceWorkerId ? { worker_id: sourceContext.source.value.sourceWorkerId } : {})
      }
    })
    return
  }

  if (sourceContext.source.value.sourcePage === 'workflow') {
    await router.push('/workflow')
    return
  }

  if (sourceContext.source.value.sourcePage === 'overview') {
    await router.push('/overview')
  }
}

const handleShellAction = async (actionId: string) => {
  if (actionId === 'go_overview') {
    await router.push('/overview')
    return
  }

  if (actionId === 'return_to_source') {
    await handleReturnToSource()
    return
  }

  if (actionId === 'open_notifications') {
    shell.setDockExpanded(true)
    shell.setActiveDockTab('notifications')
  }
}

const handleOpenRecentTarget = async (routePath: string) => {
  await router.push(routePath)
}

const handlePanelTabSelect = (tabId: DockTabId) => {
  shell.setDockExpanded(true)
  shell.setActiveDockTab(tabId)
}

const handleDockResize = (nextHeight: number) => {
  shell.setDockHeight(Math.min(Math.max(nextHeight, resolvedDockMinHeight.value), availableDockHeight.value))
}

const handleStatusBarAction = (actionId: string) => {
  if (actionId === 'toggle_panel') {
    shell.toggleDockExpanded()
    return
  }

  if (actionId === 'open_notifications') {
    shell.setDockExpanded(true)
    shell.setActiveDockTab('notifications')
    return
  }

  if (actionId === 'open_jobs') {
    shell.setDockExpanded(true)
    shell.setActiveDockTab('jobs')
    return
  }

  if (actionId === 'open_traces') {
    shell.setDockExpanded(true)
    shell.setActiveDockTab('traces')
  }
}

const handleOpenSettings = (event?: MouseEvent) => {
  if (isSettingsOpen.value) {
    isSettingsOpen.value = false
    return
  }

  updateSettingsMenuPosition(event)
  isSettingsOpen.value = true
}

const runtimeSummary = computed(() => {
  return `${runtime.statusFreshnessLabel} · ${runtime.clockFreshnessLabel}`
})

const notificationsSummary = computed(() => {
  return `${notifications.unreadCount} total · ${notifications.errorCount} error`
})

const settingsRuntimeLabel = computed(() => {
  return `${runtime.runtimeReady ? 'Runtime ready' : 'Runtime booting'} · ${runtime.worldPack?.name ?? 'No world pack loaded'}`
})

const settingsNotificationsLabel = computed(() => {
  return `${notifications.errorCount} error · ${notifications.warningCount} warning · ${notifications.unreadCount} total`
})

const statusBarActions = computed(() => {
  return [
    { id: 'toggle_panel', label: shell.isDockExpanded ? 'PANEL ON' : 'PANEL OFF', active: shell.isDockExpanded }
  ]
})

const latestNotifications = computed(() => notifications.latestItems)

const resolveNotificationToneClass = (level: 'info' | 'warning' | 'error') => {
  if (level === 'error') {
    return 'yd-tone-danger text-yd-state-danger'
  }

  if (level === 'warning') {
    return 'yd-tone-warning text-yd-state-warning'
  }

  return 'yd-tone-info text-yd-state-info'
}
</script>

<template>
  <div class="relative h-screen overflow-hidden bg-yd-app text-yd-text-primary">
    <div class="grid h-full min-w-0 overflow-hidden" :style="shellFrameStyle">
      <div class="relative min-h-0 overflow-hidden">
        <ActivityRail
          :items="activityItems"
          :active-item-id="shell.activeWorkspaceId"
          @select="handleWorkspaceSelect"
          @open-settings="handleOpenSettings"
        />
      </div>

      <WorkspaceSidebar :title="workspaceTitle" :subtitle="workspaceSubtitle" class="min-h-0 h-full overflow-hidden">
        <template #header>
          <header class="yd-shell-divider-bottom shrink-0 px-4 py-3">
            <div class="px-4 py-1">
              <div class="text-sm font-semibold text-yd-text-primary yd-font-mono">
                {{ shellClockPanelTitle }}
              </div>
              <div class="mt-2 text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
                {{ shellClockPanelSubtitle }}
              </div>
            </div>
          </header>
        </template>

        <slot name="navigation">
          <div class="yd-shell-surface yd-shell-surface--flush overflow-hidden rounded-sm">
            <div class="yd-shell-section">
              <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
                Current Workspace
              </div>
              <div class="mt-2 text-sm font-semibold text-yd-text-primary">
              {{ shellContext.workspaceTitle }}
            </div>
            <div class="mt-2 text-xs leading-5 text-yd-text-secondary">
              {{ shellContext.workspaceSubtitle }}
            </div>
          </div>

          <div class="yd-shell-section">
            <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
              Source / Context
            </div>
            <div class="mt-2 text-sm leading-6 text-yd-text-primary">
              {{ shellContext.sourceSummary ?? 'No cross-workspace source context active.' }}
            </div>
          </div>

          <div class="yd-shell-section">
            <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
              Focus Entity
            </div>
            <div class="mt-2 text-sm font-semibold text-yd-text-primary">
              {{ shellContext.focusLabel }}
            </div>
            <div class="mt-2 text-xs leading-5 text-yd-text-secondary">
              {{ shellContext.focusMeta }}
            </div>
          </div>

          <div class="yd-shell-section">
            <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
              Quick Actions
            </div>
            <div class="mt-3 grid gap-2">
              <button
                v-for="action in shellContext.quickActions"
                :key="action.id"
                type="button"
                class="yd-list-row yd-list-row--active rounded-sm px-3 py-2 text-left text-[11px] uppercase tracking-[0.12em] text-yd-text-primary transition-colors yd-font-mono disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="!action.enabled"
                @click="handleShellAction(action.id)"
              >
                {{ action.label }}
              </button>
            </div>
          </div>

          <div class="yd-shell-section">
            <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
              Recent Targets
            </div>
            <div v-if="shellContext.recentTargets.length > 0" class="mt-3 grid gap-2">
              <button
                v-for="target in shellContext.recentTargets"
                :key="target.id"
                type="button"
                class="yd-list-row rounded-sm px-3 py-2 text-left"
                @click="handleOpenRecentTarget(target.routePath)"
              >
                <div class="text-sm text-yd-text-primary">
                  {{ target.label }}
                </div>
                <div class="mt-1 text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
                  {{ target.meta }}
                </div>
              </button>
            </div>
            <div v-else class="mt-3 text-xs leading-5 text-yd-text-secondary">
              Recent operator pivots will appear here for quick return navigation.
            </div>
          </div>
          </div>
        </slot>
      </WorkspaceSidebar>

      <div class="grid min-h-0 min-w-0 overflow-hidden" :style="mainColumnStyle">
        <TopRuntimeBar />

        <div ref="dockSplit" class="grid min-h-0 min-w-0 overflow-hidden" :style="dockSplitStyle">
          <main class="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto no-scrollbar">
            <div class="min-h-full min-w-0">
              <slot />
            </div>
          </main>

          <div class="min-h-0 min-w-0 overflow-hidden">
            <BottomDock
              v-if="shell.isDockExpanded"
              :tabs="panelTabs"
              :active-tab-id="shell.activeDockTabId"
              :height="clampedDockHeight"
              :min-height="resolvedDockMinHeight"
              :max-height="availableDockHeight"
              @select="handlePanelTabSelect"
              @resize="handleDockResize"
            >
              <div class="grid gap-2">
                <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
                  {{ dockLabel }}
                </div>

                <template v-if="shell.activeDockTabId === 'notifications'">
                  <div v-if="latestNotifications.length === 0" class="yd-workbench-inset rounded-sm px-4 py-3 text-sm leading-6 text-yd-text-secondary">
                    {{ dockEmptyMessage }}
                  </div>
                  <div v-else class="grid gap-2">
                    <article
                      v-for="item in latestNotifications"
                      :key="item.id"
                      class="yd-workbench-inset rounded-sm px-4 py-3"
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="text-sm leading-6 text-yd-text-primary">
                            {{ item.content }}
                          </div>
                          <div class="mt-2 text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
                            {{ item.code ?? 'operator-notice' }} · tick {{ item.timestamp }}
                          </div>
                        </div>
                        <span
                          class="rounded-sm border px-2 py-1 text-[10px] uppercase tracking-[0.12em] yd-font-mono"
                          :class="resolveNotificationToneClass(item.level)"
                        >
                          {{ item.level }}
                        </span>
                      </div>
                    </article>
                  </div>
                </template>

                <template v-else>
                  <div v-if="dockTargets.length === 0" class="yd-workbench-inset rounded-sm px-4 py-3 text-sm leading-6 text-yd-text-secondary">
                    {{ dockEmptyMessage }}
                  </div>
                  <div v-else class="grid gap-2">
                    <button
                      v-for="target in dockTargets"
                      :key="target.id"
                      type="button"
                      class="yd-list-row rounded-sm px-4 py-3 text-left transition-colors"
                      @click="handleOpenRecentTarget(target.routePath)"
                    >
                      <div class="text-sm text-yd-text-primary">
                        {{ target.label }}
                      </div>
                      <div class="mt-2 text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
                        {{ target.meta }}
                      </div>
                    </button>
                  </div>
                </template>
              </div>
            </BottomDock>
          </div>
        </div>
      </div>
      <StatusBar
        class="min-w-0"
        :style="{ gridColumn: '1 / -1' }"
        :content-start-offset="statusBarContentOffset"
        :runtime-summary="runtimeSummary"
        :notifications-summary="notificationsSummary"
        :panel-actions="statusBarActions"
        @action="handleStatusBarAction" @open-settings="handleOpenSettings" />
    </div>

    <ShellSettingsMenu
      :open="isSettingsOpen"
      :anchor-style="settingsMenuStyle"
      :runtime-label="settingsRuntimeLabel"
      :notifications-label="settingsNotificationsLabel"
      @close="isSettingsOpen = false"
    />
  </div>
</template>
