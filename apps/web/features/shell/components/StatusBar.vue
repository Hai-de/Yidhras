<script setup lang="ts">
interface StatusBarAction {
  id: string
  label: string
  active?: boolean
}

const props = defineProps<{
  contentStartOffset?: string
  runtimeSummary: string
  notificationsSummary: string
  panelActions?: ReadonlyArray<StatusBarAction>
}>()

const emit = defineEmits<{
  action: [actionId: string]
  openSettings: [event: MouseEvent]
}>()
</script>

<template>
  <footer
    class="yd-separator-top flex h-8 min-w-0 shrink-0 items-center bg-yd-panel px-3 text-[11px] text-yd-text-secondary"
  >
    <div
      class="flex min-w-0 flex-1 items-center gap-3 overflow-hidden"
      :style="props.contentStartOffset
        ? {
            paddingLeft: `calc(${props.contentStartOffset} + 0.75rem)`
          }
        : undefined"
    >
    </div>

    <div class="ml-auto flex min-w-0 shrink-0 items-center gap-1.5 pl-3">
      <button
        v-for="action in props.panelActions ?? []"
        :key="action.id"
        type="button"
        class="yd-industrial-button rounded-sm px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] yd-font-mono"
        :class="action.active
          ? 'yd-industrial-button--active text-yd-text-primary'
          : 'text-yd-text-muted hover:text-yd-text-primary'"
        @click="emit('action', action.id)"
      >
        {{ action.label }}
      </button>
      <div class="hidden text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono lg:block">
        {{ props.runtimeSummary }}
      </div>
      <div class="hidden text-[10px] uppercase tracking-[0.12em] text-yd-text-muted yd-font-mono xl:block">
        {{ props.notificationsSummary }}
      </div>
    </div>
  </footer>
</template>
