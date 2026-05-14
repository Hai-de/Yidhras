import type { PrismaClient } from '@prisma/client';

import { createContextOverlayStore } from '../../context/overlay/store.js';
import {
  BUILTIN_PERCEPTION_RULES,
  createPerceptionRuleEngine,
  type PerceptionRuleEngine
} from '../../perception/index.js';
import type {
  PerceptionEventInput,
  PerceptionObserverRelation,
  PerceptionRuleDef
} from '../../perception/types.js';
import { pluginRuntimeRegistry } from '../../plugins/runtime.js';
import type { AppContext } from '../context.js';
import type { PackRuntimePort } from '../services/pack_runtime_ports.js';
import { resolvePackTick } from '../services/pack_runtime_resolution.js';

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
      return parsed.actor_identity_id as string;
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
  return rows;
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

const computeObserverRelation = (
  observerLocation: string | null,
  eventLocation: string | null,
  neighbors: (locationId: string) => string[]
): PerceptionObserverRelation => {
  if (!observerLocation) {
    return 'no_location';
  }
  if (!eventLocation) {
    return 'no_location';
  }
  if (observerLocation === eventLocation) {
    return 'same';
  }
  if (neighbors(observerLocation).includes(eventLocation)) {
    return 'adjacent';
  }
  return 'different';
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

const buildEngine = (
  packRules: PerceptionRuleDef[],
  packId: string
): PerceptionRuleEngine => {
  const pluginResolvers = pluginRuntimeRegistry.getPerceptionResolvers(packId);
  const pluginResolver = pluginResolvers.length > 0 ? pluginResolvers[0] : null;

  const rules = packRules.length > 0 ? packRules : BUILTIN_PERCEPTION_RULES;
  return createPerceptionRuleEngine(rules, pluginResolver);
};

export const runPerceptionPipeline = async (
  context: AppContext,
  packRuntime?: PackRuntimePort
): Promise<void> => {
  const spatialRuntime = context.getSpatialRuntime?.();
  if (!spatialRuntime) {
    return;
  }

  const packId = packRuntime?.getPackId();
  if (!packId) {
    return;
  }
  const packPrefix = `${packId}:`;

  const tick = resolvePackTick(context, packRuntime);

  const spatialEvents = await getSpatialEvents(context.prisma, tick);
  if (spatialEvents.length === 0) {
    return;
  }

  const agentIds = await getActiveAgents(context.prisma);
  if (agentIds.length === 0) {
    return;
  }

  // Load pack perception rules
  const pack = packRuntime?.getPack();
  const packRules: PerceptionRuleDef[] = pack?.rules?.perception ?? [];
  const engine = buildEngine(packRules, packId);

  // Pre-compute observer locations for all agents (batch)
  const agentLocations = new Map<string, string | null>();
  for (const agentId of agentIds) {
    const entityId = resolveEntityIdFromAgentId(agentId, packPrefix);
    if (entityId) {
      agentLocations.set(agentId, await spatialRuntime.getLocation(entityId));
    }
  }

  const overlayStore = createContextOverlayStore(context);
  const tickStr = tick.toString();

  for (const agentId of agentIds) {
    const entityId = resolveEntityIdFromAgentId(agentId, packPrefix);
    if (!entityId) {
      continue;
    }
    const observerLocation = agentLocations.get(agentId) ?? null;

    for (const event of spatialEvents) {
      const eventLocationId = event.location_id;
      const observerRelation = computeObserverRelation(
        observerLocation,
        eventLocationId,
        (locId: string) => spatialRuntime.neighbors(locId)
      );

      const eventInput: PerceptionEventInput = {
        eventId: event.id,
        eventTitle: event.title,
        eventDescription: event.description,
        locationId: eventLocationId,
        visibility: event.visibility,
        actorEntityId: extractActorEntityId(event.impact_data)
      };

      const result = await engine.evaluate({
        event: eventInput,
        observerEntityId: entityId,
        observerRelation,
        agentCapabilities: [],
        investigationCount: 0
      });

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
          visibility: event.visibility,
          matched_rule_id: result.matchedRuleId
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
