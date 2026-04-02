<script setup lang="ts">
import AppBadge from '../../../components/ui/AppBadge.vue'
import type { WorkflowTone } from '../adapters'

const props = withDefaults(
  defineProps<{
    label: string
    tone?: WorkflowTone
  }>(),
  {
    tone: 'neutral'
  }
)

const resolveBadgeTone = (tone: WorkflowTone) => {
  switch (tone) {
    case 'success':
      return 'success'
    case 'warning':
      return 'warning'
    case 'danger':
      return 'danger'
    case 'info':
      return 'info'
    default:
      return 'neutral'
  }
}
</script>

<template>
  <AppBadge :tone="resolveBadgeTone(props.tone)">
    {{ props.label }}
  </AppBadge>
</template>
