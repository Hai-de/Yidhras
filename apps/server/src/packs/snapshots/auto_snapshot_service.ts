import type { PackSnapshotMetadata } from '@yidhras/contracts';

import type { AppContext } from '../../app/context.js';
import type { PackRuntimePort } from '../../app/services/pack/pack_runtime_ports.js';
import { getRuntimeConfig } from '../../config/runtime_config.js';
import { createLogger } from '../../utils/logger.js';
import { capturePackSnapshot } from './snapshot_capture.js';
import {
  deleteSnapshotDir,
  listSnapshotDirs,
  readSnapshotMetadata,
  resolveSnapshotLocation
} from './snapshot_locator.js';

const logger = createLogger('auto-snapshot');
const AUTO_SNAPSHOT_LABEL_PREFIX = 'auto:';

export interface MaybeCaptureAutoSnapshotInput {
  context: AppContext;
  packId: string;
  packRuntime: PackRuntimePort;
}

const shouldCaptureAtTick = (tick: bigint, intervalTicks: number): boolean => {
  if (tick <= 0n) {
    return false;
  }
  return tick % BigInt(intervalTicks) === 0n;
};

const listAutoSnapshotMetadata = (packId: string): PackSnapshotMetadata[] => {
  const snapshotIds = listSnapshotDirs(packId);
  const metadata: PackSnapshotMetadata[] = [];

  for (const snapshotId of snapshotIds) {
    try {
      const location = resolveSnapshotLocation(packId, snapshotId);
      const item = readSnapshotMetadata(location);
      if (item.label?.startsWith(AUTO_SNAPSHOT_LABEL_PREFIX)) {
        metadata.push(item);
      }
    } catch (err) {
      logger.warn('Failed to read snapshot metadata during auto snapshot retention', { error: err instanceof Error ? err : new Error(String(err)), data: { pack_id: packId,
        snapshot_id: snapshotId } });
    }
  }

  return metadata.sort((a, b) => a.captured_at_timestamp.localeCompare(b.captured_at_timestamp));
};

const enforceAutoSnapshotRetention = (packId: string, retentionCount: number): void => {
  const autoSnapshots = listAutoSnapshotMetadata(packId);
  const overflowCount = autoSnapshots.length - retentionCount;
  if (overflowCount <= 0) {
    return;
  }

  for (const snapshot of autoSnapshots.slice(0, overflowCount)) {
    try {
      deleteSnapshotDir(resolveSnapshotLocation(packId, snapshot.snapshot_id));
    } catch (err) {
      logger.warn('Failed to delete old auto snapshot', { error: err instanceof Error ? err : new Error(String(err)), data: { pack_id: packId,
        snapshot_id: snapshot.snapshot_id } });
    }
  }
};

export const maybeCaptureAutoSnapshot = async ({
  context,
  packId,
  packRuntime
}: MaybeCaptureAutoSnapshotInput): Promise<void> => {
  const config = getRuntimeConfig().runtime.snapshot;
  if (!config.auto_enabled) {
    return;
  }

  const currentTick = packRuntime.getCurrentTick();
  if (!shouldCaptureAtTick(currentTick, config.interval_ticks)) {
    return;
  }

  if (context.packStorageAdapter.backend !== 'sqlite') {
    logger.warn('Auto snapshot skipped because pack storage backend is not sqlite', { data: { pack_id: packId,
      backend: context.packStorageAdapter.backend } });
    return;
  }

  try {
    const tick = currentTick.toString();
    const result = await capturePackSnapshot({
      packId,
      label: `${AUTO_SNAPSHOT_LABEL_PREFIX}${tick}`,
      prisma: context.prisma,
      packStorageAdapter: context.packStorageAdapter,
      packRuntime,
      getExperimentalTick: id => context.getPackRuntimeHandle?.(id)?.getClockSnapshot().current_tick ?? null,
      getExperimentalRevision: id => context.getPackRuntimeHandle?.(id)?.getClockSnapshot().current_tick ?? null
    });

    enforceAutoSnapshotRetention(packId, config.retention_count);

    logger.info('Auto snapshot captured', { data: { pack_id: packId,
      snapshot_id: result.metadata.snapshot_id,
      tick } });
  } catch (err) {
    logger.warn('Auto snapshot failed', { error: err instanceof Error ? err : new Error(String(err)), data: { pack_id: packId,
      tick: currentTick.toString() } });
  }
};
