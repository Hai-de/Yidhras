import type { Express, Request, Response } from 'express'
import path from 'path'

import type { AppContext } from '../context.js'
import { asyncHandler } from '../http/async_handler.js'
import { PackManifestLoader } from '../../packs/manifest/loader.js'
import { safeFs } from '../../utils/safe_fs.js'
import { ApiError } from '../../utils/api_error.js'

const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.ts': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

const resolveMimeType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] ?? 'application/octet-stream'
}

export const registerPackFrontendAssetRoutes = (
  app: Express,
  context: AppContext,
  packsDir: string
): void => {
  const loader = new PackManifestLoader(packsDir)

  app.get(
    '/api/packs/:packId/frontend/{/*assetPath}',
    asyncHandler(async (req: Request, res: Response) => {
      const packId = req.params.packId
      const assetPath = typeof req.params.assetPath === 'string' ? req.params.assetPath : ''

      if (!packId || typeof packId !== 'string' || packId.length === 0) {
        throw new ApiError(400, 'INVALID_PACK_ID', 'packId is required')
      }

      // Resolve pack folder name from pack ID
      const availableFolders = loader.listAvailablePacks()
      let packFolder: string | null = null

      for (const folderName of availableFolders) {
        const pack = loader.loadPack(folderName)
        if (pack.metadata.id === packId) {
          packFolder = folderName
          break
        }
      }

      if (!packFolder) {
        throw new ApiError(404, 'PACK_NOT_FOUND', `Pack ${packId} not found`)
      }

      // Prevent path traversal
      const normalizedAssetPath = path.normalize(assetPath).replace(/^(\.\.[/\\])+/, '')
      const resolvedPath = path.resolve(packsDir, packFolder, 'frontend', 'dist', normalizedAssetPath)

      // Verify resolved path stays within the pack's frontend/dist directory
      const packFrontendRoot = path.resolve(packsDir, packFolder, 'frontend', 'dist')
      if (!resolvedPath.startsWith(packFrontendRoot)) {
        throw new ApiError(403, 'PATH_TRAVERSAL_DENIED', 'Asset path escapes pack directory')
      }

      if (!safeFs.existsSync(packFrontendRoot, resolvedPath)) {
        throw new ApiError(404, 'ASSET_NOT_FOUND', `Asset not found: ${normalizedAssetPath}`)
      }

      const content = safeFs.readFileSync(packFrontendRoot, resolvedPath)
      const mimeType = resolveMimeType(resolvedPath)

      res.setHeader('Content-Type', mimeType)
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.send(content)
    })
  )
}
