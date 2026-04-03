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
  <div class="yd-dock-root yd-shell-surface yd-separator-top flex min-h-0 flex-col border-x-0 border-b-0 bg-yd-panel/95 backdrop-blur-sm" :style="{ height: `${clampedHeight}px` }">
    <div
      class="yd-dock-split-hit-area flex h-4 shrink-0 cursor-row-resize items-end justify-center"
      :class="isDragging ? 'yd-dock-split-hit-area--active' : ''"
      role="separator"
      aria-label="Resize bottom dock"
      aria-orientation="horizontal"
      @pointerdown.prevent="handleResizeStart"
    >
      <div class="yd-dock-split-handle" :class="isDragging ? 'yd-dock-split-handle--active' : ''">
        <span class="yd-dock-split-handle-grip" />
      </div>
    </div>

    <div class="yd-separator-bottom flex items-end gap-1 px-3">
      <button
        v-for="tab in props.tabs"
        :key="tab.id"
        type="button"
        class="relative -mb-px inline-flex h-8 items-center border-b-2 border-transparent bg-transparent px-2 text-[10px] uppercase tracking-[0.12em] transition-colors yd-font-mono"
        :class="[
          tab.id === props.activeTabId
            ? 'text-yd-text-primary after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[2px] after:bg-yd-state-accent after:content-[\'\']'
            : 'text-yd-text-muted hover:text-yd-text-primary'
        ]"
        @click="emit('select', tab.id)"
      >
        {{ tab.shortLabel }}
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-hidden px-4 py-2.5">
      <div class="h-full overflow-y-auto rounded-sm text-sm text-yd-text-secondary no-scrollbar">
        <slot>
          <div class="yd-workbench-inset rounded-sm px-4 py-3">
            Dock content placeholder
          </div>
        </slot>
      </div>
    </div>
  </div>
</template>
