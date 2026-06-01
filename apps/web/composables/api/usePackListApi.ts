import { requestApiData } from '../../lib/http/client'

export interface PackListItem {
  instance_id: string
  metadata_id: string
  folder_name: string
  name: string
  version: string
  description: string | null
  presentation: {
    cover_image?: string
    icon?: string
    theme?: Record<string, unknown>
  } | null
  frontend: {
    type: 'default' | 'custom'
    entry?: string
  } | null
  runtime_status: 'loaded' | 'not_loaded'
  runtime_ready: boolean
  health_status: string | null
  health_message: string | null
  current_tick: string | null
}

export interface PackListResponse {
  packs: PackListItem[]
}

export const usePackListApi = () => {
  return {
    listPacks: () => requestApiData<PackListResponse>('/api/packs')
  }
}
