<script setup lang="ts">
import { computed, onErrorCaptured, ref } from 'vue'

const props = defineProps<{
  title: string
  subtitle?: string
}>()

const errorMessage = ref<string | null>(null)

onErrorCaptured(error => {
  errorMessage.value = error instanceof Error ? error.message : 'Unknown plugin render error'
  return false
})

const description = computed(() => props.subtitle ?? 'Plugin runtime contribution failed to render.')
</script>

<template>
  <div>
    <div v-if="errorMessage" class="rounded-sm border border-red-500/30 bg-red-500/10 px-4 py-4">
      <div class="text-[10px] uppercase tracking-[0.12em] text-red-200 yd-font-mono">
        Plugin Render Error
      </div>
      <div class="mt-2 text-sm font-semibold text-red-100">
        {{ title }}
      </div>
      <div class="mt-2 text-xs text-red-100/90">
        {{ description }}
      </div>
      <div class="mt-2 text-xs text-red-100/80 yd-font-mono">
        {{ errorMessage }}
      </div>
    </div>
    <slot v-else />
  </div>
</template>
