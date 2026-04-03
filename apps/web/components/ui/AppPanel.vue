<script setup lang="ts">
import { computed } from 'vue'

type AppPanelSurface = 'pane' | 'inset' | 'elevated' | 'transparent'
type AppPanelDensity = 'compact' | 'comfortable'

const props = withDefaults(
  defineProps<{
    surface?: AppPanelSurface
    density?: AppPanelDensity
    bordered?: boolean
    elevated?: boolean
    padded?: boolean
  }>(),
  {
    surface: 'pane',
    density: 'comfortable',
    bordered: true,
    elevated: false,
    padded: false
  }
)

const resolvedSurface = computed<AppPanelSurface>(() => {
  return props.elevated ? 'elevated' : props.surface
})

const surfaceClass = computed(() => {
  if (resolvedSurface.value === 'transparent') {
    return props.bordered ? 'rounded-sm border border-yd-border-muted bg-transparent' : 'rounded-sm bg-transparent'
  }

  if (resolvedSurface.value === 'inset') {
    return props.bordered ? 'yd-panel-inset rounded-sm' : 'rounded-sm bg-yd-app'
  }

  if (resolvedSurface.value === 'elevated') {
    return props.bordered ? 'yd-panel-surface--elevated rounded-sm' : 'rounded-sm bg-yd-elevated'
  }

  return props.bordered ? 'yd-panel-surface rounded-sm' : 'rounded-sm bg-yd-panel'
})

const paddingClass = computed(() => {
  if (!props.padded) {
    return ''
  }

  return props.density === 'compact' ? 'px-3 py-3' : 'px-4 py-4'
})
</script>

<template>
  <div :class="[surfaceClass, paddingClass]">
    <slot />
  </div>
</template>
