import type { AppInfrastructure } from '../../../app/context.js';
import { listPackRuleExecutionRecords } from '../../storage/rule_execution_repo.js';
import type { PackProjectionMetadataSnapshot } from './pack_projection_metadata_resolver.js';

export interface PackNarrativeProjectionSnapshot {
  pack: {
    id: string;
    name: string;
    version: string;
  };
  timeline: Array<{
    id: string;
    kind: 'event' | 'rule_execution';
    created_at: string;
    title: string;
    description: string;
    refs: Record<string, string | null>;
    data: Record<string, unknown>;
  }>;
}

export interface GetPackNarrativeProjectionInput {
  pack_id: string;
  pack: PackProjectionMetadataSnapshot;
}

export interface PackNarrativeProjectionService {
  getProjection(input: GetPackNarrativeProjectionInput): Promise<PackNarrativeProjectionSnapshot>;
}

const parseEventImpactData = (value: string | null): Record<string, unknown> | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { raw: parsed };
  } catch {
    return { raw: value };
  }
};

const resolveEventBridgePackId = (impactData: Record<string, unknown> | null): string | null => {
  return impactData && typeof impactData.pack_id === 'string' ? impactData.pack_id : null;
};

export const createPackNarrativeProjectionService = (
  context: AppInfrastructure
): PackNarrativeProjectionService => {
  return {
    async getProjection(input: GetPackNarrativeProjectionInput): Promise<PackNarrativeProjectionSnapshot> {
      const [events, ruleExecutions] = await Promise.all([
        context.repos.narrative.listRecentEvents(100),
        listPackRuleExecutionRecords(context.packStorageAdapter, input.pack_id)
      ]);

      const eventTimeline = events
        .map(event => {
          const impactData = parseEventImpactData(event.impact_data);
          const bridgePackId = resolveEventBridgePackId(impactData);
          return {
            event,
            impactData,
            bridgePackId
          };
        })
        .filter(item => item.bridgePackId === input.pack_id)
        .map(({ event, impactData, bridgePackId }) => ({
          id: event.id,
          kind: 'event' as const,
          created_at: event.created_at.toString(),
          title: event.title,
          description: event.description,
          refs: {
            action_intent_id: event.source_action_intent_id,
            pack_id: bridgePackId
          },
          data: {
            tick: event.tick.toString(),
            type: event.type,
            impact_data: impactData
          }
        }));

      const executionTimeline = ruleExecutions.map(record => ({
        id: record.id,
        kind: 'rule_execution' as const,
        created_at: record.created_at.toString(),
        title: record.rule_id,
        description: record.execution_status,
        refs: {
          pack_id: input.pack_id,
          subject_entity_id: record.subject_entity_id,
          target_entity_id: record.target_entity_id,
          mediator_id: record.mediator_id
        },
        data: {
          capability_key: record.capability_key,
          execution_status: record.execution_status,
          payload_json: record.payload_json,
          emitted_events_json: record.emitted_events_json
        }
      }));

      return {
        pack: {
          id: input.pack.id,
          name: input.pack.name,
          version: input.pack.version
        },
        timeline: [...eventTimeline, ...executionTimeline].sort((left, right) => {
          const leftTick = BigInt(left.created_at);
          const rightTick = BigInt(right.created_at);
          if (leftTick === rightTick) {
            return right.id.localeCompare(left.id);
          }
          return leftTick > rightTick ? -1 : 1;
        })
      };
    }
  };
};
