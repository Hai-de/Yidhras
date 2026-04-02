const isDev = process.env.NODE_ENV === 'development'

const cssFiles = [
  '~/assets/css/main.css',
  '~/assets/css/tokens.css',
  '~/assets/css/theme-default.css',
  '~/assets/css/base.css',
  '~/assets/css/utilities.css'
]

const modules = ['@nuxt/ui', '@nuxtjs/tailwindcss', '@pinia/nuxt', '@vueuse/nuxt']

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
  }
})
