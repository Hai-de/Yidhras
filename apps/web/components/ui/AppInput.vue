<script setup lang="ts">
const model = defineModel<string>({ default: '' })

const props = withDefaults(
  defineProps<{
    type?: 'text' | 'search' | 'number'
    placeholder?: string
  }>(),
  {
    type: 'text',
    placeholder: ''
  }
)
</script>

<template>
  <input
    v-model="model"
    :type="props.type"
    :placeholder="props.placeholder"
    class="mt-2 w-full rounded-sm border border-yd-border-strong bg-yd-app px-3 py-2 text-sm text-yd-text-primary outline-none transition-colors focus:border-yd-state-accent"
  >
</template>
