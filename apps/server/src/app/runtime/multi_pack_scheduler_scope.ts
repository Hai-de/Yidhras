import { DEFAULT_SCHEDULER_PARTITION_ID, isSchedulerPartitionId } from './scheduler_partitioning.js';

const PACK_RUNTIME_SCOPE_SEPARATOR = '::';

const normalizePackId = (packId: string): string => {
  const normalized = packId.trim();
  if (normalized.length === 0) {
    throw new Error('pack runtime scope pack id is required');
  }
  if (normalized.includes(PACK_RUNTIME_SCOPE_SEPARATOR)) {
    throw new Error(`pack runtime scope pack id is invalid: ${packId}`);
  }
  return normalized;
};

const normalizePartitionId = (partitionId: string | undefined): string => {
  if (typeof partitionId !== 'string' || partitionId.trim().length === 0) {
    return DEFAULT_SCHEDULER_PARTITION_ID;
  }

  const normalized = partitionId.trim();
  if (!isSchedulerPartitionId(normalized)) {
    throw new Error(`scheduler partition id is invalid: ${partitionId}`);
  }

  return normalized;
};

export interface PackScopedSchedulerPartition {
  pack_id: string;
  partition_id: string;
  scoped_partition_id: string;
}

export const buildPackScopedSchedulerPartitionId = (
  packId: string,
  partitionId = DEFAULT_SCHEDULER_PARTITION_ID
): string => {
  return `${normalizePackId(packId)}${PACK_RUNTIME_SCOPE_SEPARATOR}${normalizePartitionId(partitionId)}`;
};

export const isPackScopedSchedulerPartitionId = (value: string): boolean => {
  return value.includes(PACK_RUNTIME_SCOPE_SEPARATOR);
};

export const parsePackScopedSchedulerPartitionId = (value: string): PackScopedSchedulerPartition => {
  const separatorIndex = value.indexOf(PACK_RUNTIME_SCOPE_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex >= value.length - PACK_RUNTIME_SCOPE_SEPARATOR.length) {
    throw new Error(`pack scoped scheduler partition id is invalid: ${value}`);
  }

  const packId = value.slice(0, separatorIndex);
  const partitionId = value.slice(separatorIndex + PACK_RUNTIME_SCOPE_SEPARATOR.length);
  return {
    pack_id: normalizePackId(packId),
    partition_id: normalizePartitionId(partitionId),
    scoped_partition_id: value
  };
};

export const tryParsePackScopedSchedulerPartitionId = (
  value: string
): PackScopedSchedulerPartition | null => {
  if (!isPackScopedSchedulerPartitionId(value)) {
    return null;
  }

  return parsePackScopedSchedulerPartitionId(value);
};

export const buildPackScopedSchedulerLeaseKey = (
  packId: string,
  partitionId = DEFAULT_SCHEDULER_PARTITION_ID
): string => {
  return buildPackScopedSchedulerPartitionId(packId, partitionId);
};

export const buildPackScopedSchedulerCursorKey = (
  packId: string,
  partitionId = DEFAULT_SCHEDULER_PARTITION_ID
): string => {
  return buildPackScopedSchedulerPartitionId(packId, partitionId);
};
