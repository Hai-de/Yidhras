<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import type { DockTabId } from '../../../stores/shell'

interface DockTab {
  id: DockTabId
  label: string
  shortLabel: string
}

const props = defineProps<{
  activeTabId: DockTabId
  tabs: ReadonlyArray<DockTab>
  height: number
  minHeight?: number
  maxHeight?: number
}>()

const emit = defineEmits<{
  select: [tabId: DockTabId]
  resize: [nextHeight: number]
}>()

const isDragging = ref(false)
const dragStartY = ref(0)
const dragStartHeight = ref(0)

const resolvedMinHeight = computed(() => props.minHeight ?? 160)
const resolvedMaxHeight = computed(() => Math.max(props.maxHeight ?? resolvedMinHeight.value, resolvedMinHeight.value))
const clampedHeight = computed(() => Math.min(Math.max(props.height, resolvedMinHeight.value), resolvedMaxHeight.value))

const clampHeight = (value: number) => {
  return Math.min(Math.max(value, resolvedMinHeight.value), resolvedMaxHeight.value)
}

const stopDragging = () => {
  if (!isDragging.value) return
  isDragging.value = false
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', stopDragging)
}

const handlePointerMove = (event: PointerEvent) => {
  if (!isDragging.value) return
  const deltaY = dragStartY.value - event.clientY
  emit('resize', clampHeight(dragStartHeight.value + deltaY))
}

const handleResizeStart = (event: PointerEvent) => {
  isDragging.value = true
  dragStartY.value = event.clientY
  dragStartHeight.value = clampedHeight.value
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', stopDragging)
}

onBeforeUnmount(() => {
  stopDragging()
})
</script>

<template>
  <div class="flex flex-col border-t border-yd-border-muted bg-yd-panel/95 backdrop-blur-sm" :style="{ height: `${clampedHeight}px` }">
    <button
      type="button"
      class="flex h-3 shrink-0 cursor-row-resize items-center justify-center text-yd-text-muted transition-colors hover:text-yd-text-primary"
      :class="isDragging ? 'text-yd-text-primary' : ''"
      aria-label="Resize bottom dock"
      @pointerdown.prevent="handleResizeStart"
    >
      <span class="h-px w-12 bg-current opacity-70" />
    </button>

    <div class="flex items-center gap-1.5 border-b border-yd-border-muted px-4 py-2">
      <button
        v-for="tab in props.tabs"
        :key="tab.id"
        type="button"
        class="rounded-sm border px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] transition-colors yd-font-mono"
        :class="[
          tab.id === props.activeTabId
            ? 'border-yd-state-accent bg-yd-elevated text-yd-text-primary'
            : 'border-yd-border-muted text-yd-text-muted hover:border-yd-border-strong hover:text-yd-text-primary'
        ]"
        @click="emit('select', tab.id)"
      >
        {{ tab.shortLabel }}
      </button>
    </div>

    <div class="min-h-0 flex-1 px-3 py-3">
      <div class="yd-panel-surface h-full overflow-y-auto rounded-md px-4 py-3 text-sm text-yd-text-secondary">
        <slot>
          Dock content placeholder
        </slot>
      </div>
    </div>
  </div>
</template>
