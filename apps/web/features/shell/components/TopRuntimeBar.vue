<script setup lang="ts">
import { computed } from 'vue'

import { useOperatorBootstrap } from '../../../composables/app/useOperatorBootstrap'
import { useNotificationsStore } from '../../../stores/notifications'
import { useRuntimeStore } from '../../../stores/runtime'
import { useShellStore } from '../../../stores/shell'

const runtime = useRuntimeStore()
const notifications = useNotificationsStore()
const shell = useShellStore()
const operatorBootstrap = useOperatorBootstrap()

const runtimeStatusLabel = computed(() => {
  if (runtime.status === 'error') {
    return runtime.runtimeReady ? 'runtime degraded' : 'runtime unavailable'
  }

  if (runtime.healthLevel === 'degraded') {
    return 'runtime degraded'
  }

  return runtime.runtimeReady ? 'runtime ready' : 'runtime booting'
})

const runtimeStatusClass = computed(() => {
  if (runtime.status === 'error') {
    return 'border-yd-state-danger text-yd-state-danger'
  }

  if (runtime.healthLevel === 'degraded') {
    return 'border-yd-state-warning text-yd-state-warning'
  }

  return 'border-yd-state-success text-yd-state-success'
})

const runtimeSpeedLabel = computed(() => {
  const effectiveStepTicks = runtime.runtimeSpeed?.effective_step_ticks ?? 'n/a'
  return `${runtime.status} · ${effectiveStepTicks} tick/step`
})

const runtimeSyncSummary = computed(() => {
  return `clock ${runtime.clockFreshnessLabel} · status ${runtime.statusFreshnessLabel}`
})

const notificationsSummary = computed(() => {
  return `${notifications.errorCount} error · ${notifications.warningCount} warning · ${notifications.unreadCount} total`
})

const notificationsStatusClass = computed(() => {
  if (notifications.errorCount > 0) {
    return 'border-yd-state-danger/40 text-yd-state-danger'
  }

  if (notifications.warningCount > 0) {
    return 'border-yd-state-warning/40 text-yd-state-warning'
  }

  return 'border-yd-border-muted text-yd-text-secondary'
})

const dockToggleLabel = computed(() => {
  return shell.isDockExpanded ? 'Hide Dock' : 'Show Dock'
})

const handleRefreshAll = async () => {
  await operatorBootstrap.refreshAll()
}
</script>

<template>
  <header class="flex min-h-16 items-center justify-between border-b border-yd-border-muted bg-yd-panel px-6 py-3">
    <div class="flex min-w-0 items-center gap-6">
      <div>
        <div class="text-[10px] uppercase tracking-[0.24em] text-yd-text-muted yd-font-mono">
          World State
        </div>
        <div class="mt-1 flex items-center gap-3">
          <span
            class="rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em] yd-font-mono"
            :class="runtimeStatusClass"
          >
            {{ runtimeStatusLabel }}
          </span>
          <span class="text-xs text-yd-text-secondary">
            {{ runtime.worldPack?.name ?? 'No world pack loaded' }}
          </span>
        </div>
        <div class="mt-2 text-[11px] text-yd-text-secondary yd-font-mono">
          {{ runtimeSyncSummary }}
        </div>
      </div>

      <div>
        <div class="text-[10px] uppercase tracking-[0.24em] text-yd-text-muted yd-font-mono">
          Time Scale
        </div>
        <div class="mt-1 text-sm text-yd-text-primary yd-font-mono">
          {{ runtime.formattedTicks }}
        </div>
        <div class="text-xs text-yd-text-secondary">
          {{ runtime.primaryCalendarTime }}
        </div>
      </div>
    </div>

    <div class="flex items-center gap-4">
      <div class="yd-panel-surface rounded-lg px-4 py-2">
        <div class="text-[10px] uppercase tracking-[0.24em] text-yd-text-muted yd-font-mono">
          Runtime Speed
        </div>
        <div class="mt-1 text-xs text-yd-text-primary yd-font-mono">
          {{ runtimeSpeedLabel }}
        </div>
      </div>

      <div class="yd-panel-surface rounded-lg border px-4 py-2" :class="notificationsStatusClass">
        <div class="text-[10px] uppercase tracking-[0.24em] yd-font-mono">
          Notifications
        </div>
        <div class="mt-1 text-xs yd-font-mono">
          {{ notificationsSummary }}
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-lg border border-yd-border-strong bg-yd-elevated px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-yd-text-primary yd-font-mono"
          @click="handleRefreshAll"
        >
          Refresh All
        </button>
        <button
          type="button"
          class="rounded-lg border border-yd-border-muted bg-yd-app px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-yd-text-secondary yd-font-mono"
          @click="shell.toggleDockExpanded()"
        >
          {{ dockToggleLabel }}
        </button>
      </div>
    </div>
  </header>
</template>
