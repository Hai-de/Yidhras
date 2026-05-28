import type { ShellContext } from '@yidhras/contracts'

import { resolveApiBaseUrl } from '../../lib/http/client'
import { useAuthStore } from '../../stores/auth'

export const buildShellContext = (packId?: string): ShellContext => {
  const auth = useAuthStore()
  const apiBaseUrl = resolveApiBaseUrl()

  return {
    auth_token: auth.token ?? '',
    pack_id: packId ?? '',
    api_base_url: apiBaseUrl
  }
}

export const useShellContext = () => {
  return buildShellContext()
}
