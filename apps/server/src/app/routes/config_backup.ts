import {
  createBackupRequestSchema,
  listBackupsQuerySchema
} from '@yidhras/contracts'
import type { NextFunction, Response } from 'express'

import type { OperatorRequest } from '../../operator/auth/types.js'
import { ApiError } from '../../utils/api_error.js'
import { asyncHandler } from '../http/async_handler.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseBody, parseQuery } from '../http/zod.js'
import {
  applyRetentionPolicy,
  createConfigBackup,
  deleteConfigBackup,
  getBackupPolicy,
  getConfigBackup,
  listConfigBackups,
  restoreConfigBackup
} from '../services/config/config_backup.js'
import type { RouteModule } from './types.js'

const requireRoot = (req: OperatorRequest, _res: Response, next: NextFunction): void => {
  if (!req.operator?.is_root) {
    throw new ApiError(403, 'ROOT_REQUIRED', 'Root operator required')
  }
  next()
}

export const configBackupRoutes: RouteModule = {
  register(app, _context) {
  // Create backup
  app.post(
    '/api/config/backups',
    requireRoot,
    asyncHandler(async (req, res) => {
      const body = parseBody(createBackupRequestSchema, req.body, 'INVALID_BACKUP_REQUEST')
      const backup = await createConfigBackup(body.name)
      jsonOk(res, toJsonSafe(backup))
    })
  )

  // List backups
  app.get(
    '/api/config/backups',
    (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, 'OPERATOR_REQUIRED', 'Authentication required')
      }
      const query = parseQuery(listBackupsQuerySchema, req.query, 'INVALID_LIST_QUERY')
      const backups = listConfigBackups(query.limit, query.offset)
      jsonOk(res, toJsonSafe(backups))
    }
  )

  // Get backup details
  app.get(
    '/api/config/backups/:id',
    (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, 'OPERATOR_REQUIRED', 'Authentication required')
      }
      const backup = getConfigBackup(req.params.id)
      if (!backup) {
        throw new ApiError(404, 'BACKUP_NOT_FOUND', `备份 ${req.params.id} 不存在`)
      }
      jsonOk(res, toJsonSafe(backup))
    }
  )

  // Download backup
  app.get(
    '/api/config/backups/:id/download',
    requireRoot,
    (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
      const backup = getConfigBackup(req.params['id'] as string)
      if (!backup) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
        throw new ApiError(404, 'BACKUP_NOT_FOUND', `备份 ${req.params['id'] as string} 不存在`)
      }
      res.download(backup.path, `${backup.id}.tar.gz`)
    }
  )

  // Delete backup
  app.delete(
    '/api/config/backups/:id',
    requireRoot,
    (req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
      const deleted = deleteConfigBackup(req.params['id'] as string)
      if (!deleted) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
        throw new ApiError(404, 'BACKUP_NOT_FOUND', `备份 ${req.params['id'] as string} 不存在`)
      }
      jsonOk(res, { deleted: true })
    }
  )

  // Restore backup
  app.post(
    '/api/config/backups/:id/restore',
    requireRoot,
    asyncHandler(async (req, res) => {
      const force = req.query['force'] === 'true'
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express param is always string at runtime
      await restoreConfigBackup(req.params['id'] as string, force)
      jsonOk(res, { restored: true })
    })
  )

  // Get backup policy
  app.get(
    '/api/config/backup-policy',
    (req, res) => {
      const operator = (req as OperatorRequest).operator
      if (!operator) {
        throw new ApiError(401, 'OPERATOR_REQUIRED', 'Authentication required')
      }
      jsonOk(res, toJsonSafe(getBackupPolicy()))
    }
  )

  // Cleanup (apply retention policy)
  app.post(
    '/api/config/backups/cleanup',
    requireRoot,
    (_req, res) => {
      const removed = applyRetentionPolicy()
      jsonOk(res, { removed })
    }
  )
  }
}
