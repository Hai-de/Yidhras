<template>
  <n-config-provider :theme="darkTheme" :theme-overrides="naiveThemeOverrides">
    <n-message-provider>
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup>
import { darkTheme, NConfigProvider, NMessageProvider } from 'naive-ui'

import { useOperatorBootstrap } from './composables/app/useOperatorBootstrap'
import { createNaiveThemeOverrides, resolveThemeTokens } from './lib/theme/resolver'

const themeTokens = resolveThemeTokens()
const naiveThemeOverrides = createNaiveThemeOverrides(themeTokens)

useOperatorBootstrap()
</script>
