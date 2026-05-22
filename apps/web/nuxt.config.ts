const isDev = process.env.NODE_ENV === 'development'

const cssFiles = [
  '~/assets/css/main.css',
  '~/assets/css/tokens.css',
  '~/assets/css/theme-default.css',
  '~/assets/css/base.css',
  '~/assets/css/utilities.css'
]

const modules = ['@nuxt/ui', '@nuxtjs/tailwindcss', '@pinia/nuxt', '@vueuse/nuxt', '@nuxtjs/i18n']

const runtimeConfig = {
  public: {
    apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:3001'
  }
}

const optimizeDepsInclude = isDev ? ['date-fns-tz/formatInTimeZone'] : []

export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  ssr: false,
  devtools: {
    enabled: isDev
  },
  typescript: {
    strict: true,
    typeCheck: true
  },
  runtimeConfig,
  modules,
  css: cssFiles,
  vite: {
    optimizeDeps: {
      include: optimizeDepsInclude
    }
  },
  i18n: {
    strategy: 'prefix_except_default',
    defaultLocale: 'en',
    locales: [
      { code: 'en', file: 'en.json', name: 'English' },
      { code: 'zh-CN', file: 'zh-CN.json', name: '简体中文' },
      { code: 'zh-TW', file: 'zh-TW.json', name: '繁體中文' },
      { code: 'ja', file: 'ja.json', name: '日本語' }
    ],
    langDir: 'locales',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'yd_locale',
      redirectOn: 'root'
    },
  }
})
