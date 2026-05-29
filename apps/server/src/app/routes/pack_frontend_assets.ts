import fs from 'node:fs';

import path from 'path';

import { ApiError } from '../../utils/api_error.js';
import { createLogger } from '../../utils/logger.js';
import { safeFs } from '../../utils/safe_fs.js';
import { asyncHandler } from '../http/async_handler.js';
import type { RouteModule } from './types.js';

const logger = createLogger('pack-frontend-assets');

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

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.ico', '.woff', '.woff2', '.gif', '.webp', '.avif'
])

const resolveMimeType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase()
  // eslint-disable-next-line security/detect-object-injection -- ext is derived from filePath, validated via safeFs
  return MIME_TYPES[ext] ?? 'application/octet-stream'
}

const isBinary = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}

export function createPackFrontendAssetRoutes(packsDir: string): RouteModule {
  return {
    register(app, context) {
      app.get(
        '/api/packs/:packId/frontend/{*assetPath}',
        asyncHandler((req, res) => {
          const packId = req.params.packId
          const rawAssetPath = req.params.assetPath

          if (!packId || typeof packId !== 'string' || packId.length === 0) {
            throw new ApiError(400, 'INVALID_PACK_ID', 'packId is required')
          }

          // Express 5 {*param} captures path segments as an array;
          // Express 4 *param returns a string. Handle both.
          const assetPath = Array.isArray(rawAssetPath)
            ? rawAssetPath.join('/')
            : typeof rawAssetPath === 'string'
              ? rawAssetPath
              : ''

          if (!assetPath || assetPath.length === 0) {
            throw new ApiError(400, 'MISSING_ASSET_PATH', 'Asset path is required')
          }

          const resolved = context.packCatalog.resolveByInstanceId(packId)
          if (!resolved) {
            throw new ApiError(404, 'PACK_NOT_FOUND', `Pack ${packId} not found`)
          }

          const packFolder = resolved.packFolderName

          // Prevent path traversal
          const normalizedAssetPath = path.normalize(assetPath).replace(/^(\.\.[/\\])+/, '')
          const packFrontendRoot = path.resolve(packsDir, packFolder, 'frontend', 'dist')
          const resolvedPath = path.resolve(packFrontendRoot, normalizedAssetPath)

          // Verify resolved path stays within the pack's frontend/dist directory
          if (!resolvedPath.startsWith(packFrontendRoot + path.sep) && resolvedPath !== packFrontendRoot) {
            throw new ApiError(403, 'PATH_TRAVERSAL_DENIED', 'Asset path escapes pack directory')
          }

          if (!safeFs.existsSync(packFrontendRoot, resolvedPath)) {
            throw new ApiError(404, 'ASSET_NOT_FOUND', `Asset not found: ${normalizedAssetPath}`)
          }

          const absolutePath = safeFs.inBase(packFrontendRoot, resolvedPath)

          // Reject directories — only serve regular files
          let stat: fs.Stats
          try {
            // eslint-disable-next-line security/detect-non-literal-fs-filename -- absolutePath validated via path traversal check + safeFs.existsSync
          stat = fs.statSync(absolutePath)
          } catch {
            throw new ApiError(404, 'ASSET_NOT_FOUND', `Asset not found: ${normalizedAssetPath}`)
          }

          if (!stat.isFile()) {
            logger.warn(`Requested asset path is not a file: ${normalizedAssetPath} (pack=${packId})`)
            throw new ApiError(404, 'ASSET_NOT_FOUND', `Asset not found: ${normalizedAssetPath}`)
          }

          const mimeType = resolveMimeType(resolvedPath)
          const isDev = process.env.NODE_ENV === 'development'
          const cacheControl = isDev ? 'no-cache' : 'public, max-age=3600'

          if (isBinary(resolvedPath)) {
            // eslint-disable-next-line security/detect-non-literal-fs-filename -- absolutePath validated via path traversal check + safeFs.existsSync
          const content = fs.readFileSync(absolutePath)
            res.setHeader('Content-Type', mimeType)
            res.setHeader('Cache-Control', cacheControl)
            res.end(content)
          } else {
            const content = safeFs.readFileSync(packFrontendRoot, resolvedPath)
            res.setHeader('Content-Type', mimeType)
            res.setHeader('Cache-Control', cacheControl)
            res.send(content)
          }
        })
      )
    }
  };
}

