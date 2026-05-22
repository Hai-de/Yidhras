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
      class="rounded-sm border-0 bg-transparent px-1 py-1.5 text-xl leading-none cursor-pointer select-none transition-[transform,box-shadow] hover:scale-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-yd-state-accent/60"
      :title="currentNative"
      @click.stop="toggle"
    >
      🌏
    </button>
    <div
      v-if="open"
      class="absolute left-1/2 top-full z-20 mt-1 min-w-[120px] -translate-x-1/2 rounded-sm border border-yd-border-muted bg-yd-elevated py-1 shadow-[0_8px_20px_rgba(0,0,0,0.28)]"
    >
      <button
        v-for="opt in localeOptions"
        :key="opt.code"
        type="button"
        class="block w-full px-3 py-1.5 text-left text-xs text-yd-text-secondary yd-font-mono hover:bg-yd-panel hover:text-yd-text-primary"
        :class="{ 'text-yd-state-accent': opt.code === locale }"
        @click.stop="selectLocale(opt.code)"
      >
        {{ opt.native }}
      </button>
    </div>
  </div>
</template>
