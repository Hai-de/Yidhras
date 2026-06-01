<script setup lang="ts">
const { locale, setLocale } = useI18n()

const localeOptions = [
  { code: 'en', native: 'English' },
  { code: 'zh-CN', native: '简体中文' },
  { code: 'zh-TW', native: '繁體中文' },
  { code: 'ja', native: '日本語' }
] as const

type SupportedLocale = (typeof localeOptions)[number]['code']

const open = ref(false)

const currentNative = computed(() =>
  localeOptions.find(o => o.code === locale.value)?.native ?? 'English'
)

const selectLocale = (code: SupportedLocale) => {
  setLocale(code)
  open.value = false
}

const toggle = () => {
  open.value = !open.value
}

const closeOnClickOutside = (event: MouseEvent) => {
  if (!(event.target instanceof HTMLElement)) return
  if (!event.target.closest('.yd-locale-switcher')) {
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', closeOnClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeOnClickOutside)
})
</script>

<template>
  <div class="yd-locale-switcher relative inline-flex">
    <button
      type="button"
      class="rounded-sm border border-yd-border-muted bg-transparent px-2 py-1 text-[10px] tracking-[0.12em] uppercase cursor-pointer select-none transition-[transform,box-shadow] hover:border-yd-state-accent/60 hover:text-yd-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-yd-state-accent/60 text-yd-text-secondary yd-font-mono"
      :title="currentNative"
      @click.stop="toggle"
    >
      {{ $t('common.switch_language') }}
    </button>
    <div
      v-if="open"
      class="absolute left-1/2 top-full z-20 mt-1 min-w-[120px] -translate-x-1/2 border-0 bg-transparent py-1"
    >
      <button
        v-for="opt in localeOptions"
        :key="opt.code"
        type="button"
        class="block w-full appearance-none rounded-none border-0 px-3 py-1.5 text-left text-xs cursor-pointer select-none transition-colors yd-font-mono"
        :class="opt.code === locale ? 'text-yd-state-accent' : 'text-yd-text-secondary hover:text-yd-text-primary'"
        @click.stop="selectLocale(opt.code)"
      >
        {{ opt.native }}
      </button>
    </div>
  </div>
</template>
