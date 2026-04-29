import {
  createSnapshotRequestSchema,
  listSnapshotsResponseSchema,
  restoreSnapshotRequestSchema
} from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import { packAccessGuard } from '../../operator/guard/pack_access.js';
import { capturePackSnapshot } from '../../packs/snapshots/snapshot_capture.js';
import {
  listSnapshotDirs,
  readSnapshotMetadata,
  resolveSnapshotLocation
} from '../../packs/snapshots/snapshot_locator.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import { jsonOk } from '../http/json.js';
import { parseBody, parseParams } from '../http/zod.js';

const SNAPSHOT_NOT_AVAILABLE_MESSAGE =
  '快照功能仅支持 SQLite 后端。当前后端不支持快照，请使用数据库原生工具进行备份（如 PostgreSQL 的 pg_dump、pg_basebackup 等）。';

const requireSqliteBackend = (context: AppContext): void => {
  if (context.packStorageAdapter.backend !== 'sqlite') {
    throw new ApiError(501, 'SNAPSHOT_NOT_AVAILABLE', SNAPSHOT_NOT_AVAILABLE_MESSAGE);
  }
};

const packIdParamsSchema = z.object({
  packId: z.string().trim().min(1)
});

const snapshotIdParamsSchema = z.object({
  packId: z.string().trim().min(1),
  snapshotId: z.string().trim().min(1)
});

export interface PackSnapshotRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

export const registerPackSnapshotRoutes = (
  app: Express,
  context: AppContext,
  deps: PackSnapshotRouteDependencies
): void => {
  // GET /api/packs/:packId/snapshots — list snapshots
  app.get(
    '/api/packs/:packId/snapshots',
    packAccessGuard(context, { packIdParam: 'packId' }),
    (req, res) => {
      context.assertRuntimeReady('snapshot list');
      requireSqliteBackend(context);
      const params = parseParams(packIdParamsSchema, req.params, 'SNAPSHOT_LIST_INVALID');

      const snapshotIds = listSnapshotDirs(params.packId);
      const snapshots = snapshotIds.map((snapshotId) => {
        const location = resolveSnapshotLocation(params.packId, snapshotId);
        const metadata = readSnapshotMetadata(location);
        return {
          snapshot_id: metadata.snapshot_id,
          label: metadata.label,
          captured_at_tick: metadata.captured_at_tick,
          captured_at_timestamp: metadata.captured_at_timestamp,
          runtime_db_size_bytes: metadata.runtime_db_size_bytes,
          prisma_record_count: metadata.prisma_record_count
        };
      });

      const body = listSnapshotsResponseSchema.parse({ snapshots });
      jsonOk(res, body);
    }
  );

  // POST /api/packs/:packId/snapshots — create snapshot
  app.post(
    '/api/packs/:packId/snapshots',
    packAccessGuard(context, { packIdParam: 'packId' }),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('snapshot create');
      requireSqliteBackend(context);
      const params = parseParams(packIdParamsSchema, req.params, 'SNAPSHOT_CREATE_INVALID');
      const body = parseBody(createSnapshotRequestSchema, req.body, 'SNAPSHOT_CREATE_BODY_INVALID');

      context.setPaused(true);

      const getExperimentalTick = (packId: string): string | null => {
        const handle = context.sim.getPackRuntimeHandle(packId);
        return handle?.getClockSnapshot().current_tick ?? null;
      };

      const getExperimentalRevision = (packId: string): string | null => {
        const handle = context.sim.getPackRuntimeHandle(packId);
        return handle?.getClockSnapshot().current_tick ?? null;
      };

      const result = await capturePackSnapshot({
        packId: params.packId,
        label: body.label,
        prisma: context.prisma,
        packStorageAdapter: context.packStorageAdapter,
        activePackRuntime: context.activePackRuntime,
        getExperimentalTick,
        getExperimentalRevision
      });

      context.setPaused(false);

      context.notifications.push(
        'info',
        `已为包 "${params.packId}" 创建快照 "${result.metadata.snapshot_id}" (tick ${result.metadata.captured_at_tick})`,
        'SNAPSHOT_CREATED'
      );

      jsonOk(res, {
        snapshot_id: result.metadata.snapshot_id,
        pack_id: result.metadata.pack_id,
        captured_at_tick: result.metadata.captured_at_tick,
        prisma_record_count: result.metadata.prisma_record_count,
        runtime_db_size_bytes: result.metadata.runtime_db_size_bytes
      });
    })
  );

  // POST /api/packs/:packId/snapshots/:snapshotId/restore — restore snapshot
  app.post(
    '/api/packs/:packId/snapshots/:snapshotId/restore',
    packAccessGuard(context, { packIdParam: 'packId' }),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('snapshot restore');
      requireSqliteBackend(context);
      const params = parseParams(snapshotIdParamsSchema, req.params, 'SNAPSHOT_RESTORE_INVALID');
      const body = parseBody(restoreSnapshotRequestSchema, req.body, 'SNAPSHOT_RESTORE_BODY_INVALID');

      if (!body.confirm_data_loss) {
        throw new ApiError(
          409,
          'SNAPSHOT_DATA_LOSS_UNCONFIRMED',
          `Restoring snapshot "${params.snapshotId}" will replace all current runtime data for pack "${params.packId}". Set confirm_data_loss: true to proceed.`
        );
      }

      const activePack = context.activePack?.getActivePack();
      const activeRuntimePack = context.activePackRuntime?.getActivePack();
      const pack = activeRuntimePack ?? activePack;

      if (!pack) {
        throw new ApiError(404, 'PACK_NOT_LOADED', 'No active pack is currently loaded');
      }

      if (pack.metadata.id !== params.packId) {
        throw new ApiError(400, 'PACK_ID_MISMATCH', 'Active pack does not match requested packId');
      }

      context.setPaused(true);

      const { restorePackSnapshot } = await import('../../packs/snapshots/snapshot_restore.js');

      const result = await restorePackSnapshot({
        packId: params.packId,
        snapshotId: params.snapshotId,
        prisma: context.prisma,
        packStorageAdapter: context.packStorageAdapter,
        pack,
        sim: context.sim,
        activePackRuntime: context.activePackRuntime,
        worldEngine: context.worldEngine,
        notifications: context.notifications
      });

      context.setPaused(false);

      jsonOk(res, {
        restored: true as const,
        pack_id: result.pack_id,
        snapshot_id: result.snapshot_id,
        restored_at_tick: result.restored_at_tick
      });
    })
  );

  // DELETE /api/packs/:packId/snapshots/:snapshotId — delete snapshot
  app.delete(
    '/api/packs/:packId/snapshots/:snapshotId',
    packAccessGuard(context, { packIdParam: 'packId' }),
    deps.asyncHandler(async (req, res) => {
      context.assertRuntimeReady('snapshot delete');
      requireSqliteBackend(context);
      const params = parseParams(snapshotIdParamsSchema, req.params, 'SNAPSHOT_DELETE_INVALID');

      const location = resolveSnapshotLocation(params.packId, params.snapshotId);

      const { deleteSnapshotDir } = await import('../../packs/snapshots/snapshot_locator.js');
      deleteSnapshotDir(location);

      context.notifications.push(
        'info',
        `已删除包 "${params.packId}" 的快照 "${params.snapshotId}"`,
        'SNAPSHOT_DELETED'
      );

      jsonOk(res, {
        deleted: true as const,
        snapshot_id: params.snapshotId
      });
    })
  );
};
