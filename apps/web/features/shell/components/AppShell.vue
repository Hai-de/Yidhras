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
const MIN_DOCK_HEIGHT = 160
const MIN_MAIN_HEIGHT = 160
const dockSplitRef = useTemplateRef<HTMLElement>('dockSplit')
const availableDockHeight = ref(DEFAULT_DOCK_HEIGHT)
let dockResizeObserver: ResizeObserver | null = null

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

const updateAvailableDockHeight = () => {
  if (!dockSplitRef.value) {
    availableDockHeight.value = resolvedDockDefaultHeight.value
    return
  }

  const splitHeight = dockSplitRef.value.clientHeight
  const nextMaxHeight = Math.max(splitHeight - MIN_MAIN_HEIGHT, resolvedDockMinHeight.value)
  availableDockHeight.value = nextMaxHeight

  if (shell.dockHeight > nextMaxHeight) {
    shell.setDockHeight(nextMaxHeight)
  }
}

const clampedDockHeight = computed(() => {
  return Math.min(Math.max(shell.dockHeight, resolvedDockMinHeight.value), availableDockHeight.value)
})

const handleWindowResize = () => {
  updateAvailableDockHeight()
}

onMounted(async () => {
  await nextTick()
  updateAvailableDockHeight()

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleWindowResize)
  }

  if (typeof ResizeObserver !== 'undefined' && dockSplitRef.value) {
    dockResizeObserver = new ResizeObserver(() => {
      updateAvailableDockHeight()
    })
    const observedElement = dockSplitRef.value
    dockResizeObserver.observe(observedElement)
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleWindowResize)
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

const traceTargets = computed(() => {
  return shellContext.value.recentTargets.filter(target => target.id.startsWith('workflow:')).slice(0, 4)
})

const jobTargets = computed(() => {
  return shellContext.value.recentTargets
    .filter(target => target.id.startsWith('workflow:') || target.id.startsWith('agent:'))
    .slice(0, 4)
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
  if (actionId === 'settings') {
    isSettingsOpen.value = !isSettingsOpen.value
    return
  }

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

const handleOpenSettings = () => {
  isSettingsOpen.value = !isSettingsOpen.value
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
    { id: 'open_traces', label: 'TR', active: shell.isDockExpanded && shell.activeDockTabId === 'traces' },
    { id: 'open_jobs', label: 'JB', active: shell.isDockExpanded && shell.activeDockTabId === 'jobs' },
    { id: 'open_notifications', label: 'NT', active: shell.isDockExpanded && shell.activeDockTabId === 'notifications' },
    { id: 'toggle_panel', label: shell.isDockExpanded ? 'PANEL ON' : 'PANEL OFF', active: shell.isDockExpanded }
  ]
})

const latestNotifications = computed(() => notifications.latestItems)
const pageLayoutStyle = {
  gap: 'var(--yd-layout-section-gap)',
  padding: 'var(--yd-layout-page-padding-y) var(--yd-layout-page-padding-x)'
} as const
</script>

<template>
  <div class="relative h-screen overflow-hidden bg-yd-app text-yd-text-primary">
    <div class="flex h-[calc(100%-2rem)] min-w-0 overflow-hidden">
      <div class="relative shrink-0">
        <ActivityRail
          :items="activityItems"
          :active-item-id="shell.activeWorkspaceId"
          @select="handleWorkspaceSelect"
          @open-settings="handleOpenSettings"
        />
      </div>

      <WorkspaceSidebar :title="workspaceTitle" :subtitle="workspaceSubtitle" class="h-full">
        <slot name="navigation">
          <div class="yd-shell-surface overflow-hidden rounded-sm">
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
                  class="yd-list-row rounded-sm px-3 py-2 text-left text-[11px] uppercase tracking-[0.12em] text-yd-text-primary transition-colors yd-font-mono disabled:cursor-not-allowed disabled:opacity-40"
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
                  <div class="text-xs font-semibold text-yd-text-primary">
                    {{ target.label }}
                  </div>
                  <div class="mt-1 text-[10px] uppercase tracking-[0.12em] text-yd-text-secondary yd-font-mono">
                    {{ target.meta }}
                  </div>
                </button>
              </div>
              <div v-else class="mt-2 text-xs text-yd-text-secondary">
                No recent targets recorded yet.
              </div>
            </div>

            <div class="yd-shell-section">
              <div class="text-[10px] uppercase tracking-[0.14em] text-yd-text-muted yd-font-mono">
                Runtime Sync
              </div>
              <div class="mt-2 text-sm text-yd-text-primary yd-font-mono">
                tick {{ runtime.formattedTicks }}
              </div>
              <div class="mt-2 text-xs leading-5 text-yd-text-secondary">
                status {{ runtime.statusFreshnessLabel }} · clock {{ runtime.clockFreshnessLabel }}
              </div>
            </div>
          </div>
        </slot>
      </WorkspaceSidebar>

      <div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopRuntimeBar class="shrink-0" />

        <div ref="dockSplit" class="min-h-0 flex flex-1 flex-col overflow-hidden">
          <main class="min-h-0 flex-1 overflow-auto">
            <div :style="pageLayoutStyle">
              <slot />
            </div>
          </main>

          <BottomDock
            v-if="shell.isDockExpanded"
            class="shrink-0"
            :active-tab-id="shell.activeDockTabId"
            :tabs="panelTabs"
            :height="clampedDockHeight"
            :min-height="resolvedDockMinHeight"
            :max-height="availableDockHeight"
            @select="handlePanelTabSelect"
            @resize="handleDockResize"
          >
            <div v-if="shell.activeDockTabId === 'traces'" class="grid gap-2.5 lg:grid-cols-2">
              <button
                v-for="target in traceTargets"
                :key="target.id"
                type="button"
                class="yd-list-row rounded-sm px-3 py-3 text-left"
                @click="handleOpenRecentTarget(target.routePath)"
              >
                <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
                  Trace Context
                </div>
                <div class="mt-2 text-sm text-yd-text-primary">
                  {{ target.label }}
                </div>
                <div class="mt-2 text-xs text-yd-text-secondary">
                  {{ target.meta }}
                </div>
              </button>
              <div
                v-if="traceTargets.length === 0"
                class="yd-workbench-inset rounded-sm px-3 py-3 text-xs text-yd-text-secondary lg:col-span-2"
              >
                No recent workflow trace context recorded yet.
              </div>
            </div>

            <div v-else-if="shell.activeDockTabId === 'jobs'" class="grid gap-2.5 lg:grid-cols-2">
              <button
                v-for="target in jobTargets"
                :key="target.id"
                type="button"
                class="yd-list-row rounded-sm px-3 py-3 text-left"
                @click="handleOpenRecentTarget(target.routePath)"
              >
                <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
                  Recent Target
                </div>
                <div class="mt-2 text-sm text-yd-text-primary">
                  {{ target.label }}
                </div>
                <div class="mt-2 text-xs text-yd-text-secondary">
                  {{ target.meta }}
                </div>
              </button>
              <div
                v-if="jobTargets.length === 0"
                class="yd-workbench-inset rounded-sm px-3 py-3 text-xs text-yd-text-secondary lg:col-span-2"
              >
                No recent job-oriented targets recorded yet.
              </div>
            </div>

            <div v-else class="grid gap-2.5 lg:grid-cols-3">
              <div class="yd-workbench-inset rounded-sm px-3 py-3 lg:col-span-3">
                <div
                  class="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono"
                >
                  <span>Notifications</span>
                  <span class="text-yd-text-primary">{{ notifications.unreadCount }}</span>
                </div>
                <div v-if="latestNotifications.length > 0" class="mt-2 space-y-2">
                  <div
                    v-for="item in latestNotifications"
                    :key="item.id"
                    class="yd-detail-grid-item rounded-sm px-3 py-2"
                  >
                    <div class="text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono">
                      {{ item.level }}
                    </div>
                    <div class="mt-1 text-xs text-yd-text-secondary">
                      {{ item.content }}
                    </div>
                  </div>
                </div>
                <div v-else class="mt-2 text-xs text-yd-text-secondary">
                  No system notifications yet.
                </div>
              </div>
            </div>
          </BottomDock>
        </div>
      </div>
    </div>

    <ShellSettingsMenu
      :open="isSettingsOpen"
      :runtime-label="settingsRuntimeLabel"
      :notifications-label="settingsNotificationsLabel"
      @close="isSettingsOpen = false"
    />

    <StatusBar
      class="relative z-20"
      :workspace-label="shellContext.workspaceTitle"
      :focus-label="shellContext.focusLabel"
      :runtime-summary="runtimeSummary"
      :notifications-summary="notificationsSummary"
      :panel-actions="statusBarActions"
      @action="handleStatusBarAction"
      @open-settings="handleOpenSettings"
    />
  </div>
</template>
