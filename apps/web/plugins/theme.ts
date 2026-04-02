import { storeToRefs } from 'pinia'

import { applyResolvedTheme } from '../lib/theme/apply-css-vars'
import { resolveThemeWithDiagnostics } from '../lib/theme/resolver'
import { useRuntimeStore } from '../stores/runtime'

export default defineNuxtPlugin(() => {
  const runtime = useRuntimeStore()
  const { worldPack } = storeToRefs(runtime)

  const applyCurrentTheme = () => {
    const { theme, issues, source } = resolveThemeWithDiagnostics(undefined, {
      worldPackId: worldPack.value?.id ?? null,
      worldPack: worldPack.value
    })

    applyResolvedTheme(theme, { source })

    if (import.meta.dev) {
      console.info('[theme] active source', source)

      if (issues.length > 0) {
        console.warn('[theme] resolve diagnostics', { source, issues })
      }
    }
  }

  applyCurrentTheme()

  watch(worldPack, () => {
    applyCurrentTheme()
  })
})
