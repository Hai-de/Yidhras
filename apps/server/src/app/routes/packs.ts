import type { Request, Response } from 'express'

import { jsonOk } from '../http/json.js'
import type { RouteModule } from './types.js'

interface PackListItem {
  instance_id: string
  metadata_id: string
  folder_name: string
  name: string
  version: string
  description: string | null
  presentation: Record<string, unknown> | null
  frontend: Record<string, unknown> | null
  runtime_status: 'loaded' | 'not_loaded'
  runtime_ready: boolean
  health_status: string | null
  health_message: string | null
  current_tick: string | null
}

export function createPackListRoutes(_packsDir: string): RouteModule {
  return {
    register(app, context) {
      app.get(
        '/api/packs',
        (_req: Request, res: Response) => {
          const loader = context.packCatalog.getLoader()
          const availableFolders = loader.listAvailablePacks()
      const loadedIds = context.listLoadedPackRuntimeIds
        ? context.listLoadedPackRuntimeIds()
        : []

      const runtimeStatusMap = new Map(
        loadedIds.map(id => {
          const handle = context.getPackRuntimeHandle?.(id)
          const healthSnapshot = handle?.getHealthSnapshot()
          const clockSnapshot = handle?.getClockSnapshot()

          return [
            id,
            {
              runtime_ready:
                healthSnapshot?.status === 'running' || healthSnapshot?.status === 'loaded',
              health_status: healthSnapshot?.status ?? null,
              health_message: healthSnapshot?.message ?? null,
              current_tick: clockSnapshot?.current_tick ?? null
            }
          ]
        })
      )

      const packs: PackListItem[] = []

      for (const folderName of availableFolders) {
        const pack = loader.loadPack(folderName)
        const metadata = pack.metadata
        const instanceId = loader.deriveInstanceId(pack, folderName)
        const runtime = runtimeStatusMap.get(instanceId)

        packs.push({
          instance_id: instanceId,
          metadata_id: metadata.id,
          folder_name: folderName,
          name: metadata.name,
          version: metadata.version,
          description: metadata.description ?? null,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- YAML config boundary
          presentation: (metadata.presentation as Record<string, unknown>) ?? null,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- YAML config boundary
          frontend: (metadata as Record<string, unknown>)['frontend'] as Record<string, unknown> ?? null,
          runtime_status: runtime ? 'loaded' : 'not_loaded',
          runtime_ready: runtime?.runtime_ready ?? false,
          health_status: runtime?.health_status ?? null,
          health_message: runtime?.health_message ?? null,
          current_tick: runtime?.current_tick ?? null
        })
      }

      jsonOk(res, { packs })
    }
  )
    }
  };
}
