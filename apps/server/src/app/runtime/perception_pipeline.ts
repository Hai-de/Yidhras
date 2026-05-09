import type { PrismaClient } from '@prisma/client';

import { createContextOverlayStore } from '../../context/overlay/store.js';
import { createSpatialProximityResolver } from '../../perception/index.js';
import type { PerceptionResolver, ResolvePerceptionInput } from '../../perception/types.js';
import { pluginRuntimeRegistry } from '../../plugins/runtime.js';
import type { AppContext } from '../context.js';

interface SpatialEventRow {
  id: string;
  title: string;
  description: string;
  impact_data: string | null;
  location_id: string | null;
  visibility: string | null;
  source_action_intent_id: string | null;
}

interface AgentRow {
  id: string;
}

const extractActorEntityId = (impactData: string | null): string | null => {
  if (!impactData) {
    return null;
  }
  try {
    const parsed = JSON.parse(impactData);
    if (parsed && typeof parsed === 'object' && typeof parsed.actor_identity_id === 'string') {
      return parsed.actor_identity_id;
    }
  } catch {
    // ignore parse errors
  }
  return null;
};

const getSpatialEvents = async (prisma: PrismaClient, tick: bigint): Promise<SpatialEventRow[]> => {
  const rows = await prisma.event.findMany({
    where: {
      tick,
      location_id: { not: null }
    },
    select: {
      id: true,
      title: true,
      description: true,
      impact_data: true,
      location_id: true,
      visibility: true,
      source_action_intent_id: true
    }
  });
  return rows as SpatialEventRow[];
};

const getActiveAgents = async (prisma: PrismaClient): Promise<string[]> => {
  const rows = await prisma.agent.findMany({
    where: { type: 'active' },
    select: { id: true }
  });
  return rows.map((r) => r.id);
};

const resolveEntityIdFromAgentId = (agentId: string, packPrefix: string): string | null => {
  if (!agentId.startsWith(packPrefix)) {
    return null;
  }
  const entityId = agentId.slice(packPrefix.length);
  if (!entityId) {
    return null;
  }
  return entityId;
};

const buildPerceptionOverlayTitle = (event: SpatialEventRow, level: string): string => {
  return `[${level}] ${event.title}`;
};

const buildPerceptionOverlayText = (event: SpatialEventRow, locationId: string | null): string => {
  if (locationId) {
    return `[地点: ${locationId}] ${event.description}`;
  }
  return event.description;
};

export const runPerceptionPipeline = async (context: AppContext): Promise<void> => {
  const spatialRuntime = context.getSpatialRuntime?.();
  if (!spatialRuntime) {
    return;
  }

  const activePack = context.activePackRuntime?.getActivePack();
  if (!activePack) {
    return;
  }
  const packId = activePack.metadata.id;
  const packPrefix = `${packId}:`;

  const tick = context.activePackRuntime!.getCurrentTick();

  const spatialEvents = await getSpatialEvents(context.prisma, tick);
  if (spatialEvents.length === 0) {
    return;
  }

  const agentIds = await getActiveAgents(context.prisma);
  if (agentIds.length === 0) {
    return;
  }

  const pluginResolvers = pluginRuntimeRegistry.getPerceptionResolvers(packId);
  const resolver: PerceptionResolver =
    pluginResolvers.length > 0 ? pluginResolvers[0] : createSpatialProximityResolver();
  const overlayStore = createContextOverlayStore(context);
  const tickStr = tick.toString();

  for (const agentId of agentIds) {
    const entityId = resolveEntityIdFromAgentId(agentId, packPrefix);
    if (!entityId) {
      continue;
    }

    for (const event of spatialEvents) {
      const input: ResolvePerceptionInput = {
        eventId: event.id,
        eventTitle: event.title,
        eventDescription: event.description,
        locationId: event.location_id,
        visibility: event.visibility,
        eventActorEntityId: extractActorEntityId(event.impact_data)
      };

      const result = await resolver.resolve(input, entityId, spatialRuntime);
      if (result.level === 'none') {
        continue;
      }

      await overlayStore.createEntry({
        id: `perception:${agentId}:${event.id}`,
        actor_id: agentId,
        pack_id: packId,
        overlay_type: 'system_summary',
        title: buildPerceptionOverlayTitle(event, result.level),
        content_text: buildPerceptionOverlayText(event, event.location_id),
        content_structured: {
          event_id: event.id,
          perception_level: result.level,
          location_id: event.location_id,
          visibility: event.visibility
        },
        tags: ['perception', 'spatial'],
        status: 'active',
        persistence_mode: 'sticky',
        source_node_ids: [],
        created_by: 'system',
        created_at_tick: tickStr,
        updated_at_tick: tickStr
      });
    }
  }
};
