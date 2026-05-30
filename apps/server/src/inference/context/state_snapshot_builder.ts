import type { AppInfrastructure } from '../../app/context.js';
import { getLatestEventEvidenceRecord } from '../../app/services/mutation/event_evidence_repository.js';
import { DEFAULT_PACK_WORLD_ENTITY_ID } from '../../packs/runtime/core_models.js';
import { listPackEntityStateProjectionRecords } from '../../packs/storage/entity_state_projection.js';
import type { PackStorageAdapter } from '../../packs/storage/PackStorageAdapter.js';
import { packEntityIdFromResolvedAgentId } from '../../packs/utils/pack_entity_id.js';
import { captureError } from '../../utils/capture_error.js';
import { extractSemanticType } from '../helpers.js';
import type {
  InferencePackArtifactSnapshot,
  InferencePackLatestEventSnapshot,
  InferencePackStateRecord,
  InferencePackStateSnapshot} from '../types.js';
import type { StateSnapshotInput } from './types.js';

export interface StateSnapshotContext {
  prisma: AppInfrastructure['prisma'];
}

const parseStateRecord = (value: unknown): InferencePackStateRecord => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated as object above
    return value as InferencePackStateRecord;
  }
  return {};
};

const fetchRecentEvents = async (
  context: StateSnapshotContext,
  packId: string,
  limit: number
): Promise<InferencePackLatestEventSnapshot[]> => {
  if (!context.prisma) return [];

  try {
    const rows = await context.prisma.event.findMany({
      where: { pack_id: packId },
      orderBy: { tick: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        type: true,
        impact_data: true,
        tick: true,
        created_at: true
      }
    });

    return rows.map((row) => ({
      event_id: row.id,
      title: row.title,
      type: row.type,
      semantic_type: extractSemanticType(row.impact_data),
      tick: row.tick.toString(),
      created_at: row.created_at.toString()
    }));
  } catch (err: unknown) {
    captureError(err, { module: 'state-snapshot-builder', message: 'Failed to build state snapshot — returning empty array' });
    return [];
  }
};

export const buildPackStateSnapshot = async (
  context: StateSnapshotContext,
  adapter: PackStorageAdapter,
  input: StateSnapshotInput
): Promise<InferencePackStateSnapshot> => {
  const { packId, resolvedAgentId, attributes } = input;

  const rows = await listPackEntityStateProjectionRecords(adapter, packId);

  const candidateEntityIds: string[] = [];
  if (resolvedAgentId) {
    const packEntityId = packEntityIdFromResolvedAgentId(packId, resolvedAgentId);
    if (packEntityId) candidateEntityIds.push(packEntityId);
    if (!candidateEntityIds.includes(resolvedAgentId)) candidateEntityIds.push(resolvedAgentId);
  }

  let actorState: InferencePackStateRecord | null = null;
  let worldState: InferencePackStateRecord | null = null;
  const artifacts: InferencePackArtifactSnapshot[] = [];

  for (const row of rows) {
    const state = parseStateRecord(row.state_json);
    if (candidateEntityIds.length > 0 && candidateEntityIds.includes(row.entity_id) && row.state_namespace === 'core') {
      actorState = state;
      continue;
    }
    if (row.entity_id === DEFAULT_PACK_WORLD_ENTITY_ID && row.state_namespace === 'world') {
      worldState = state;
      continue;
    }
    if (row.state_namespace === 'artifact') {
      artifacts.push({ id: row.entity_id, state });
    }
  }

  const actorRoles = Array.isArray(attributes['actor_roles'])
    ? attributes['actor_roles'].filter((entry): entry is string => typeof entry === 'string')
    : [];

  const latestEventRecord = await getLatestEventEvidenceRecord(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- partial AppInfrastructure
    { prisma: context.prisma } as AppInfrastructure,
    packId
  );

  const latestEvent = latestEventRecord
    ? {
        event_id: latestEventRecord.id,
        title: latestEventRecord.title,
        type: latestEventRecord.type,
        semantic_type: extractSemanticType(latestEventRecord.impact_data),
        tick: latestEventRecord.tick.toString(),
        created_at: latestEventRecord.created_at.toString()
      }
    : null;

  const recentEvents = await fetchRecentEvents(context, packId, 20);

  return {
    actor_roles: actorRoles,
    actor_state: actorState,
    owned_artifacts: artifacts,
    world_state: worldState,
    latest_event: latestEvent,
    recent_events: recentEvents
  };
};
