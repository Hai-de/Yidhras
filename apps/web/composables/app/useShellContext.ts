import type { ShellContext } from '@yidhras/contracts'
import { useRoute } from 'vue-router'

import { resolveApiBaseUrl } from '../../lib/http/client'
import { useAuthStore } from '../../stores/auth'

export const buildShellContext = (): ShellContext => {
  const auth = useAuthStore()
  const route = useRoute()

  const packId = (route.params.packId as string) ?? ''
  const apiBaseUrl = resolveApiBaseUrl()

  return {
    auth_token: auth.token ?? '',
    pack_id: packId,
    api_base_url: apiBaseUrl
  }
}

export const useShellContext = () => {
  return buildShellContext()
}
