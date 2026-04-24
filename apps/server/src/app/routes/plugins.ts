import {
  pluginEnableRequestSchema,
  pluginImportConfirmRequestSchema,
  pluginInstallationParamsSchema,
  pluginListResponseDataSchema,
  pluginOperationAcknowledgementSchema,
  pluginPackParamsSchema
} from '@yidhras/contracts'
import type { Express, NextFunction, Request, Response } from 'express'

import { OPERATOR_CAPABILITY } from '../../operator/constants.js'
import { packAccessGuard } from '../../operator/guard/pack_access.js'
import type { AppContext } from '../context.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { parseBody, parseParams } from '../http/zod.js'
import { capabilityGuard } from '../middleware/capability.js'
import {
  confirmPackPluginImport,
  disablePackPlugin,
  enablePackPlugin,
  listPackPluginInstallations
} from '../services/plugins.js'

export interface PluginRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void
}

export const registerPluginRoutes = (
  app: Express,
  context: AppContext,
  deps: PluginRouteDependencies
): void => {
  // GET list — read-only, packAccessGuard only
  app.get(
    '/api/packs/:packId/plugins',
    packAccessGuard(context, { packIdParam: 'packId' }),
    deps.asyncHandler(async (req, res) => {
      const params = parseParams(pluginPackParamsSchema, req.params, 'PLUGIN_QUERY_INVALID')
      const snapshot = await listPackPluginInstallations(context, params.packId)
      pluginListResponseDataSchema.parse(toJsonSafe(snapshot))
      jsonOk(res, toJsonSafe(snapshot))
    })
  )

  const pluginMutateGuard = capabilityGuard(
    context,
    OPERATOR_CAPABILITY.MANAGE_PLUGINS,
    { packIdParam: 'packId' }
  )

  app.post(
    '/api/packs/:packId/plugins/:installationId/confirm',
    packAccessGuard(context, { packIdParam: 'packId' }),
    pluginMutateGuard,
    deps.asyncHandler(async (req, res) => {
      const packParams = parseParams(pluginPackParamsSchema, { packId: req.params.packId }, 'PLUGIN_INSTALLATION_INVALID')
      const installationParams = parseParams(pluginInstallationParamsSchema, { installationId: req.params.installationId }, 'PLUGIN_INSTALLATION_INVALID')
      const body = parseBody(pluginImportConfirmRequestSchema, req.body, 'PLUGIN_INSTALLATION_INVALID')

      const installation = await confirmPackPluginImport(context, installationParams.installationId, body.granted_capabilities)
      pluginOperationAcknowledgementSchema.parse({ acknowledged: true, pack_id: packParams.packId, installation: toJsonSafe(installation) })
      jsonOk(res, toJsonSafe({ acknowledged: true, pack_id: packParams.packId, installation }))
    })
  )

  app.post(
    '/api/packs/:packId/plugins/:installationId/enable',
    packAccessGuard(context, { packIdParam: 'packId' }),
    pluginMutateGuard,
    deps.asyncHandler(async (req, res) => {
      const packParams = parseParams(pluginPackParamsSchema, { packId: req.params.packId }, 'PLUGIN_INSTALLATION_INVALID')
      const installationParams = parseParams(pluginInstallationParamsSchema, { installationId: req.params.installationId }, 'PLUGIN_INSTALLATION_INVALID')
      const body = parseBody(pluginEnableRequestSchema, req.body, 'PLUGIN_INSTALLATION_INVALID')

      const installation = await enablePackPlugin(context, installationParams.installationId, body.acknowledgement)
      pluginOperationAcknowledgementSchema.parse({ acknowledged: true, pack_id: packParams.packId, installation: toJsonSafe(installation) })
      jsonOk(res, toJsonSafe({ acknowledged: true, pack_id: packParams.packId, installation }))
    })
  )

  app.post(
    '/api/packs/:packId/plugins/:installationId/disable',
    packAccessGuard(context, { packIdParam: 'packId' }),
    pluginMutateGuard,
    deps.asyncHandler(async (req, res) => {
      const packParams = parseParams(pluginPackParamsSchema, { packId: req.params.packId }, 'PLUGIN_INSTALLATION_INVALID')
      const installationParams = parseParams(pluginInstallationParamsSchema, { installationId: req.params.installationId }, 'PLUGIN_INSTALLATION_INVALID')

      const installation = await disablePackPlugin(context, installationParams.installationId)
      pluginOperationAcknowledgementSchema.parse({ acknowledged: true, pack_id: packParams.packId, installation: toJsonSafe(installation) })
      jsonOk(res, toJsonSafe({ acknowledged: true, pack_id: packParams.packId, installation }))
    })
  )
}
