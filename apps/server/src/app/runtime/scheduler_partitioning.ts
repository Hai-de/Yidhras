export const DEFAULT_SCHEDULER_PARTITION_ID = 'p0';
export const DEFAULT_SCHEDULER_PARTITION_COUNT = 4;

const SCHEDULER_PARTITION_ID_PATTERN = /^p\d+$/;

const parsePositiveInteger = (value: string | undefined): number | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const parseNonNegativeInteger = (value: string | undefined): number | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
};

const hashString = (value: string): number => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }

  return hash >>> 0;
};

export const buildSchedulerPartitionId = (index: number): string => {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(`partition index is invalid: ${String(index)}`);
  }

  return `p${index}`;
};

export const isSchedulerPartitionId = (value: string): boolean => {
  return SCHEDULER_PARTITION_ID_PATTERN.test(value);
};

export const getSchedulerPartitionCount = (): number => {
  return parsePositiveInteger(process.env.SCHEDULER_PARTITION_COUNT) ?? DEFAULT_SCHEDULER_PARTITION_COUNT;
};

export const listSchedulerPartitionIds = (partitionCount = getSchedulerPartitionCount()): string[] => {
  return Array.from({ length: partitionCount }, (_unused, index) => buildSchedulerPartitionId(index));
};

export const normalizeSchedulerPartitionIds = (
  partitionIds: string[],
  partitionCount = getSchedulerPartitionCount()
): string[] => {
  const allowedPartitionIds = new Set(listSchedulerPartitionIds(partitionCount));
  const normalized: string[] = [];

  for (const partitionId of partitionIds) {
    const trimmed = partitionId.trim();
    if (!isSchedulerPartitionId(trimmed)) {
      throw new Error(`scheduler partition id is invalid: ${partitionId}`);
    }
    if (!allowedPartitionIds.has(trimmed)) {
      throw new Error(`scheduler partition id is out of configured range: ${partitionId}`);
    }
    if (!normalized.includes(trimmed)) {
      normalized.push(trimmed);
    }
  }

  return normalized;
};

export const parseSchedulerWorkerPartitionList = (
  value: string | undefined,
  partitionCount = getSchedulerPartitionCount()
): string[] | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const partitionIds = value
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);

  if (partitionIds.length === 0) {
    return null;
  }

  return normalizeSchedulerPartitionIds(partitionIds, partitionCount);
};

export const resolveSchedulerPartitionId = (
  agentId: string,
  partitionCount = getSchedulerPartitionCount()
): string => {
  if (partitionCount <= 1) {
    return DEFAULT_SCHEDULER_PARTITION_ID;
  }

  return buildSchedulerPartitionId(hashString(agentId) % partitionCount);
};

export const resolveOwnedSchedulerPartitionIds = (input?: {
  explicitPartitionIds?: string[];
  workerId?: string;
  partitionCount?: number;
}): string[] => {
  const partitionCount = input?.partitionCount ?? getSchedulerPartitionCount();

  if (Array.isArray(input?.explicitPartitionIds)) {
    return normalizeSchedulerPartitionIds(input.explicitPartitionIds, partitionCount);
  }

  const envPartitions = parseSchedulerWorkerPartitionList(process.env.SCHEDULER_WORKER_PARTITIONS, partitionCount);
  if (envPartitions !== null) {
    return envPartitions;
  }

  const workerTotal = parsePositiveInteger(process.env.SCHEDULER_WORKER_TOTAL);
  const workerIndex = parseNonNegativeInteger(process.env.SCHEDULER_WORKER_INDEX);
  if (workerTotal !== null && workerIndex !== null) {
    if (workerIndex >= workerTotal) {
      throw new Error(
        `scheduler worker index is out of range: workerIndex=${String(workerIndex)} workerTotal=${String(workerTotal)}`
      );
    }

    return listSchedulerPartitionIds(partitionCount).filter((_partitionId, index) => index % workerTotal === workerIndex);
  }

  return listSchedulerPartitionIds(partitionCount);
};
