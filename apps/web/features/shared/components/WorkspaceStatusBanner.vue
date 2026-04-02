<script setup lang="ts">
import AppAlert from '../../../components/ui/AppAlert.vue'

const props = defineProps<{
  tone?: 'danger' | 'warning' | 'info'
  title?: string
  message: string
}>()
</script>

<template>
  <AppAlert :tone="props.tone" :title="props.title">
    {{ props.message }}
  </AppAlert>
</template>
