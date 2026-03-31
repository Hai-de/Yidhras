import tsconfigPaths from 'vite-tsconfig-paths'

export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  ssr: false,
  devtools: { enabled: true },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:3001'
    }
  },
  modules: ['@nuxtjs/tailwindcss', '@pinia/nuxt', '@vueuse/nuxt'],
  css: [
    '~/assets/css/main.css',
    '~/assets/css/tokens.css',
    '~/assets/css/theme-default.css',
    '~/assets/css/base.css',
    '~/assets/css/utilities.css'
  ],
  build: {
    transpile:
      process.env.NODE_ENV === 'production'
        ? ['naive-ui', 'vueuc', '@css-render/vue3-ssr', '@juggle/resize-observer']
        : ['@juggle/resize-observer']
  },
  vite: {
    optimizeDeps: {
      include:
        process.env.NODE_ENV === 'development'
          ? ['naive-ui', 'vueuc', 'date-fns-tz/formatInTimeZone']
          : []
    },
    plugins: [tsconfigPaths()]
  }
})
