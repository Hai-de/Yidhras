import type { Express, Request, Response } from 'express'

import { PackManifestLoader } from '../../packs/manifest/loader.js'
import type { AppContext } from '../context.js'
import { asyncHandler } from '../http/async_handler.js'
import { jsonOk } from '../http/json.js'

interface PackListItem {
  id: string
  folder_name: string
  name: string
  version: string
  description: string | null
  presentation: Record<string, unknown> | null
  frontend: Record<string, unknown> | null
  runtime_status: 'loaded' | 'not_loaded'
  health_status: string | null
  current_tick: string | null
}

export const registerPackListRoutes = (
  app: Express,
  context: AppContext,
  packsDir: string
): void => {
  const loader = new PackManifestLoader(packsDir)

  app.get(
    '/api/packs',
    asyncHandler(async (_req: Request, res: Response) => {
      const availableFolders = loader.listAvailablePacks()
      const loadedIds = context.listLoadedPackRuntimeIds
        ? context.listLoadedPackRuntimeIds()
        : []

      const runtimeStatusMap = new Map(
        loadedIds.map(id => {
          const handle = context.getPackRuntimeHandle?.(id)
          return [
            id,
            {
              health_status: handle?.getHealthSnapshot().status ?? 'loaded',
              current_tick: handle?.getClockSnapshot().current_tick ?? null
            }
          ]
        })
      )

      const packs: PackListItem[] = []

      for (const folderName of availableFolders) {
        const pack = loader.loadPack(folderName)
        const metadata = pack.metadata
        const runtime = runtimeStatusMap.get(metadata.id)

        packs.push({
          id: metadata.id,
          folder_name: folderName,
          name: metadata.name,
          version: metadata.version,
          description: metadata.description ?? null,
          presentation: (metadata.presentation as Record<string, unknown>) ?? null,
          frontend: (metadata as Record<string, unknown>).frontend as Record<string, unknown> ?? null,
          runtime_status: runtime ? 'loaded' : 'not_loaded',
          health_status: runtime?.health_status ?? null,
          current_tick: runtime?.current_tick ?? null
        })
      }

      jsonOk(res, { packs })
    })
  )
}
