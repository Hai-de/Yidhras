import { storeToRefs } from 'pinia'

import { applyResolvedTheme, resetToBaseline } from '../lib/theme/apply-css-vars'
import { resolveThemeWithDiagnostics } from '../lib/theme/resolver'
import { clearRegisteredWorldPackThemeConfig } from '../lib/theme/source'
import { useRuntimeStore } from '../stores/runtime'

export default defineNuxtPlugin(() => {
  const runtime = useRuntimeStore()
  const { worldPack } = storeToRefs(runtime)
  const route = useRoute()

  let lastPackId: string | null = null

  const applyCurrentTheme = () => {
    const packId = (route.params.packId as string | undefined) ?? worldPack.value?.instance_id ?? null

    const { theme, issues, source } = resolveThemeWithDiagnostics(undefined, {
      worldPackId: packId,
      worldPack: worldPack.value
    })

    if (lastPackId && lastPackId !== packId) {
      clearRegisteredWorldPackThemeConfig(lastPackId)
    }

    applyResolvedTheme(theme, { source })
    lastPackId = packId

    if (import.meta.dev) {
      console.info('[theme] active source', source)

      if (issues.length > 0) {
        console.warn('[theme] resolve diagnostics', { source, issues })
      }
    }
  }

  applyCurrentTheme()

  watch(
    () => route.params.packId ?? worldPack.value?.instance_id,
    () => {
      if (lastPackId && lastPackId !== (route.params.packId as string | undefined)) {
        resetToBaseline()
        if (lastPackId) {
          clearRegisteredWorldPackThemeConfig(lastPackId)
        }
      }
      applyCurrentTheme()
    }
  )
})
