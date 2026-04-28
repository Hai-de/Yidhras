import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import { getWorldPacksDir } from '../../config/runtime_config.js';
import { packAccessGuard } from '../../operator/guard/pack_access.js';
import { listPackOpenings } from '../../packs/openings/discovery.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseBody, parseParams } from '../http/zod.js';

const packIdParamsSchema = z.object({
  packId: z.string().trim().min(1)
});

const applyOpeningParamsSchema = z.object({
  packId: z.string().trim().min(1),
  openingId: z.string().trim().min(1)
});

const applyOpeningBodySchema = z.object({
  confirm_data_loss: z.boolean().optional().default(false)
});

export interface PackOpeningsRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

export const registerPackOpeningRoutes = (
  app: Express,
  context: AppContext,
  deps: PackOpeningsRouteDependencies
): void => {
  app.get(
    '/api/packs/:packId/openings',
    packAccessGuard(context, { packIdParam: 'packId' }),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('pack openings list');
      const params = parseParams(packIdParamsSchema, req.params, 'OPENING_LIST_INVALID');
      const packDir = `${getWorldPacksDir()}/${params.packId}`;
      const openings = listPackOpenings(packDir);
      jsonOk(res, { openings: toJsonSafe(openings) });
    })
  );

  app.post(
    '/api/packs/:packId/openings/:openingId/apply',
    packAccessGuard(context, { packIdParam: 'packId' }),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('pack openings apply');
      const params = parseParams(applyOpeningParamsSchema, req.params, 'OPENING_APPLY_INVALID');
      const body = parseBody(applyOpeningBodySchema, req.body, 'OPENING_APPLY_BODY_INVALID');

      const activePack = context.activePack.getActivePack();
      const isActive = activePack?.metadata.id === params.packId;

      if (isActive && !body.confirm_data_loss) {
        throw new ApiError(
          409,
          'OPENING_DATA_LOSS_UNCONFIRMED',
          `Pack "${params.packId}" is currently active. Applying opening "${params.openingId}" will clear all runtime data. Set confirm_data_loss: true to proceed.`
        );
      }

      if (isActive && body.confirm_data_loss) {
        const { reinitializePackRuntime } = await import('../../core/runtime_reinitializer.js');
        const handle = context.sim.getPackRuntimeHandle(params.packId);
        const packFolderName = handle?.pack_folder_name ?? params.packId;
        await reinitializePackRuntime({
          sim: context.sim,
          packFolderName,
          packId: params.packId,
          openingId: params.openingId,
          prisma: context.prisma,
          notifications: context.notifications
        });
        jsonOk(res, {
          reinitialized: true,
          pack_id: params.packId,
          opening_id: params.openingId
        });
        return;
      }

      jsonOk(res, {
        applied: true,
        pack_id: params.packId,
        opening_id: params.openingId,
        note: 'Opening will take effect on next initialization.'
      });
    })
  );
};
