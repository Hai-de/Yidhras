<script setup lang="ts">
interface StatusBarAction {
  id: string
  label: string
  active?: boolean
}

const props = defineProps<{
  workspaceLabel: string
  focusLabel: string
  runtimeSummary: string
  notificationsSummary: string
  panelActions: ReadonlyArray<StatusBarAction>
}>()

const emit = defineEmits<{
  action: [actionId: string]
  openSettings: []
}>()
</script>

<template>
  <footer class="flex h-8 shrink-0 items-center justify-between border-t border-yd-border-muted bg-yd-panel px-3 text-[11px] text-yd-text-secondary">
    <div class="flex min-w-0 items-center gap-3">
      <button
        type="button"
        class="rounded-sm border border-transparent px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-yd-text-muted transition-colors hover:border-yd-border-muted hover:text-yd-text-primary yd-font-mono"
        @click="emit('openSettings')"
      >
        Settings
      </button>
      <div class="truncate text-[10px] uppercase tracking-[0.18em] text-yd-text-muted yd-font-mono">
        {{ props.workspaceLabel }}
      </div>
      <div class="hidden truncate text-xs text-yd-text-secondary xl:block">
        {{ props.focusLabel }}
      </div>
    </div>

    <div class="flex min-w-0 items-center gap-2">
      <button
        v-for="action in props.panelActions"
        :key="action.id"
        type="button"
        class="rounded-sm border px-2 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors yd-font-mono"
        :class="action.active
          ? 'border-yd-state-accent bg-yd-elevated text-yd-text-primary'
          : 'border-yd-border-muted text-yd-text-muted hover:border-yd-border-strong hover:text-yd-text-primary'"
        @click="emit('action', action.id)"
      >
        {{ action.label }}
      </button>
      <div class="hidden text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono lg:block">
        {{ props.runtimeSummary }}
      </div>
      <div class="hidden text-[10px] uppercase tracking-[0.16em] text-yd-text-muted yd-font-mono xl:block">
        {{ props.notificationsSummary }}
      </div>
    </div>
  </footer>
</template>
