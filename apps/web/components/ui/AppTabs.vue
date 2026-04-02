<script setup lang="ts">
import AppButton from './AppButton.vue'

const props = defineProps<{
  items: string[]
  activeItem: string
}>()

const emit = defineEmits<{
  change: [item: string]
}>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <AppButton
      v-for="item in props.items"
      :key="item"
      variant="secondary"
      size="sm"
      :class="props.activeItem === item ? 'border-yd-state-accent bg-yd-elevated text-yd-text-primary' : ''"
      @click="emit('change', item)"
    >
      {{ item }}
    </AppButton>
  </div>
</template>
