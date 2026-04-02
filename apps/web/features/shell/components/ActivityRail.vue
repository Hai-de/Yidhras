<script setup lang="ts">
export interface ActivityRailItem {
  id: string
  label: string
  shortLabel: string
  disabled?: boolean
}

const props = defineProps<{
  items: ReadonlyArray<ActivityRailItem>
  activeItemId: string
}>()

const emit = defineEmits<{
  select: [itemId: ActivityRailItem['id']]
  openSettings: []
}>()

const handleSelect = (item: ActivityRailItem) => {
  if (item.disabled) return
  emit('select', item.id)
}
</script>

<template>
  <aside class="flex h-full w-20 shrink-0 flex-col justify-between border-r border-yd-border-muted bg-yd-panel px-3 py-4">
    <div class="space-y-3">
      <div
        class="yd-panel-surface flex h-12 w-12 items-center justify-center rounded-lg text-sm font-bold text-yd-state-accent yd-font-mono"
      >
        YD
      </div>

      <div class="space-y-2">
        <button
          v-for="item in props.items"
          :key="item.id"
          type="button"
          class="flex h-12 w-12 items-center justify-center rounded-lg border text-xs font-semibold transition-colors yd-font-mono"
          :class="[
            item.id === props.activeItemId
              ? 'border-yd-state-accent bg-yd-elevated text-yd-text-primary shadow-yd'
              : 'border-yd-border-muted bg-transparent text-yd-text-muted hover:border-yd-border-strong hover:bg-yd-elevated hover:text-yd-text-primary',
            item.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
          ]"
          :title="item.label"
          @click="handleSelect(item)"
        >
          {{ item.shortLabel }}
        </button>
      </div>
    </div>

    <button
      type="button"
      class="rounded-lg border border-yd-border-muted bg-transparent px-2 py-3 text-[10px] uppercase tracking-[0.18em] text-yd-text-muted transition-colors hover:border-yd-border-strong hover:bg-yd-elevated hover:text-yd-text-primary yd-font-mono"
      title="Settings"
      @click="emit('openSettings')"
    >
      ST
    </button>
  </aside>
</template>
