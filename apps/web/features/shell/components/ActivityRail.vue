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
  openSettings: [event: MouseEvent]
}>()

const handleSelect = (item: ActivityRailItem) => {
  if (item.disabled) return
  emit('select', item.id)
}
</script>

<template>
  <aside
    class="yd-separator-right flex h-full shrink-0 flex-col justify-between bg-yd-panel px-2 py-3"
    :style="{ width: 'var(--yd-layout-shell-rail-width)' }"
  >
    <div class="space-y-3">
      <div class="yd-industrial-button yd-industrial-button--active flex h-11 items-center justify-center rounded-sm text-sm font-semibold text-yd-text-primary">
        <span class="tracking-[0.08em]">YD</span>
      </div>

      <div class="space-y-1">
        <button
          v-for="item in props.items"
          :key="item.id"
          type="button"
          class="yd-industrial-button relative flex h-10 w-full items-center justify-center rounded-sm text-[10px] font-semibold yd-font-mono"
          :class="[
            item.id === props.activeItemId
              ? 'yd-industrial-button--active text-yd-text-primary'
              : 'text-yd-text-muted hover:text-yd-text-primary',
            item.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
          ]"
          :title="item.label"
          @click="handleSelect(item)"
        >
          <span
            v-if="item.id === props.activeItemId"
            class="absolute left-1.5 top-2.5 h-5 w-0.5 bg-yd-state-accent"
          />
          {{ item.shortLabel }}
        </button>
      </div>
    </div>

    <button
      type="button"
      class="yd-industrial-button relative flex h-10 w-full items-center justify-center rounded-sm text-[10px] font-semibold text-yd-text-muted yd-font-mono hover:text-yd-text-primary"
      title="Settings"
      data-yd-shell-settings-trigger="true"
      @click="emit('openSettings', $event)"
    >
      ST
    </button>
  </aside>
</template>
