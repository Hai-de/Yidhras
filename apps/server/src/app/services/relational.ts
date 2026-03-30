import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';

export interface ListAtmosphereNodesInput {
  owner_id?: string;
  include_expired?: boolean;
}

export interface ListRelationshipAdjustmentLogsInput {
  from_id?: string;
  to_id?: string;
  type?: string;
  limit?: number;
}

export interface GraphViewInput {
  view?: string;
  root_id?: string;
  depth?: number;
  kinds?: string[];
  include_inactive?: boolean;
  include_unresolved?: boolean;
  search?: string;
}

export interface GraphNodeView {
  id: string;
  kind: 'agent' | 'atmosphere' | 'relay' | 'container';
  label: string;
  render_type?: 'avatar' | 'chip' | 'relay' | 'blackbox';
  display?: {
    avatar_url?: string | null;
    image_url?: string | null;
    icon?: string | null;
    accent_token?: string | null;
  };
  state?: {
    is_pinned?: boolean;
    activity_status?: 'active' | 'inactive' | 'idle' | 'unknown';
    resolve_state?: 'open' | 'merged' | 'resolved' | 'sealed';
    lifecycle_status?: 'active' | 'idle' | 'gc_candidate' | 'recycled' | 'sealed';
  };
  refs?: {
    agent_id?: string | null;
    atmosphere_node_id?: string | null;
    source_action_intent_id?: string | null;
    source_event_id?: string | null;
    source_inference_id?: string | null;
    merged_into_node_id?: string | null;
  };
  metadata?: Record<string, unknown>;
}

export interface GraphEdgeView {
  id: string;
  source: string;
  target: string;
  kind: 'relationship' | 'ownership' | 'transmission' | 'derived_from';
  label?: string;
  weight?: number | null;
  refs?: {
    relationship_id?: string | null;
    action_intent_id?: string | null;
    event_id?: string | null;
  };
  metadata?: Record<string, unknown>;
}

export interface GraphViewSnapshot {
  schema_version: 'graph-v2';
  view: 'mesh' | 'tree';
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  summary: {
    counts_by_kind: Record<string, number>;
    active_root_ids: string[];
    returned_node_count: number;
    returned_edge_count: number;
    applied_filters: {
      kinds: string[] | null;
      root_id: string | null;
      depth: number;
      include_inactive: boolean;
      include_unresolved: boolean;
      search: string | null;
    };
  };
}

const DEFAULT_RELATIONSHIP_LOG_LIMIT = 20;
const MAX_RELATIONSHIP_LOG_LIMIT = 100;
const DEFAULT_GRAPH_DEPTH = 1;
const MAX_GRAPH_DEPTH = 3;
const GRAPH_NODE_KINDS = ['agent', 'atmosphere', 'relay', 'container'] as const;

const parseGraphView = (value: string | undefined): 'mesh' | 'tree' => {
  return value === 'tree' ? 'tree' : 'mesh';
};

const parseGraphDepth = (value: number | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_GRAPH_DEPTH;
  }

  return Math.min(MAX_GRAPH_DEPTH, Math.max(0, Math.trunc(value)));
};

const parseGraphKinds = (value: string[] | undefined): Array<(typeof GRAPH_NODE_KINDS)[number]> | null => {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const normalized = Array.from(
    new Set(
      value
        .map(item => item.trim())
        .filter(item => item.length > 0)
    )
  );

  if (normalized.length === 0) {
    return null;
  }

  const invalidKinds = normalized.filter(item => !(GRAPH_NODE_KINDS as readonly string[]).includes(item));
  if (invalidKinds.length > 0) {
    throw new ApiError(400, 'GRAPH_VIEW_QUERY_INVALID', 'kinds contains unsupported graph node kind', {
      invalid_kinds: invalidKinds,
      allowed_kinds: GRAPH_NODE_KINDS
    });
  }

  return normalized as Array<(typeof GRAPH_NODE_KINDS)[number]>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const normalizeSearch = (value: string | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
};

const getNeighborhoodNodeIds = (
  rootId: string,
  depth: number,
  relationships: Array<{ from_id: string; to_id: string }>,
  atmosphereNodes: Array<{ id: string; owner_id: string }>,
  actionIntents: Array<{
    id: string;
    actor_ref: unknown;
    source_inference_id: string;
    status: string;
  }>
): Set<string> => {
  const visited = new Set<string>([rootId]);
  let frontier = new Set<string>([rootId]);

  for (let level = 0; level < depth; level += 1) {
    const next = new Set<string>();

    for (const nodeId of frontier) {
      for (const relationship of relationships) {
        if (relationship.from_id === nodeId && !visited.has(relationship.to_id)) {
          visited.add(relationship.to_id);
          next.add(relationship.to_id);
        }
        if (relationship.to_id === nodeId && !visited.has(relationship.from_id)) {
          visited.add(relationship.from_id);
          next.add(relationship.from_id);
        }
      }

      for (const atmosphereNode of atmosphereNodes) {
        if (atmosphereNode.owner_id === nodeId && !visited.has(atmosphereNode.id)) {
          visited.add(atmosphereNode.id);
          next.add(atmosphereNode.id);
        }
      }

      for (const intent of actionIntents) {
        const actorAgentId = isRecord(intent.actor_ref) && typeof intent.actor_ref.agent_id === 'string'
          ? intent.actor_ref.agent_id
          : null;
        const relayNodeId = buildRelayNodeId(intent.id);
        const containerNodeId = buildContainerNodeId(intent.id);

        if (actorAgentId === nodeId) {
          if (!visited.has(relayNodeId)) {
            visited.add(relayNodeId);
            next.add(relayNodeId);
          }
          if (intent.status === 'failed' && !visited.has(containerNodeId)) {
            visited.add(containerNodeId);
            next.add(containerNodeId);
          }
        }

        if (relayNodeId === nodeId && actorAgentId && !visited.has(actorAgentId)) {
          visited.add(actorAgentId);
          next.add(actorAgentId);
        }

        if (containerNodeId === nodeId && !visited.has(relayNodeId)) {
          visited.add(relayNodeId);
          next.add(relayNodeId);
        }
      }
    }

    frontier = next;
    if (frontier.size === 0) {
      break;
    }
  }

  return visited;
};

const buildRelayNodeId = (actionIntentId: string): string => {
  return `relay:${actionIntentId}`;
};

const buildContainerNodeId = (actionIntentId: string): string => {
  return `container:${actionIntentId}`;
};

const buildRelayType = (intentType: string): 'messenger' | 'resource' | 'custom' => {
  if (intentType === 'post_message') {
    return 'messenger';
  }

  if (intentType === 'adjust_relationship' || intentType === 'adjust_snr') {
    return 'resource';
  }

  return 'custom';
};

const buildContainerType = (intent: {
  dispatch_error_code: string | null;
  status: string;
}): 'unsupported_intent' | 'anonymous_source' | 'parse_failure' | 'unresolved_entity' | 'system_boundary' | 'custom' => {
  if (intent.dispatch_error_code === 'ACTION_DISPATCH_FAIL') {
    return 'parse_failure';
  }

  if (intent.dispatch_error_code === 'ACTION_EVENT_ACTOR_INVALID') {
    return 'anonymous_source';
  }

  if (intent.status === 'failed') {
    return 'unresolved_entity';
  }

  return 'custom';
};

const matchesSearch = (node: GraphNodeView, search: string | null): boolean => {
  if (!search) {
    return true;
  }

  const candidates = [
    node.id,
    node.kind,
    node.label,
    ...(node.metadata ? Object.values(node.metadata).map(value => String(value)) : [])
  ]
    .join(' ')
    .toLowerCase();

  return candidates.includes(search);
};

export const getRelationalGraph = async (context: AppContext) => {
  return context.sim.getGraphData();
};

export const getGraphView = async (
  context: AppContext,
  input: GraphViewInput
): Promise<GraphViewSnapshot> => {
  const view = parseGraphView(input.view);
  const depth = parseGraphDepth(input.depth);
  const kinds = parseGraphKinds(input.kinds);
  const rootId = typeof input.root_id === 'string' && input.root_id.trim().length > 0 ? input.root_id.trim() : null;
  const search = normalizeSearch(input.search);
  const includeInactive = input.include_inactive === true;
  const includeUnresolved = input.include_unresolved !== false;
  const now = context.sim.clock.getTicks();

  const [agents, relationships, atmosphereNodes, activeBindings, actionIntents] = await Promise.all([
    context.prisma.agent.findMany({
      orderBy: {
        created_at: 'asc'
      }
    }),
    context.prisma.relationship.findMany({
      orderBy: {
        created_at: 'asc'
      }
    }),
    context.prisma.atmosphereNode.findMany({
      where: includeInactive
        ? {}
        : {
            OR: [{ expires_at: null }, { expires_at: { gt: now } }]
          },
      orderBy: {
        created_at: 'asc'
      }
    }),
    context.prisma.identityNodeBinding.findMany({
      where: {
        role: 'active',
        status: 'active',
        agent_id: {
          not: null
        }
      },
      select: {
        agent_id: true
      }
    }),
    context.prisma.actionIntent.findMany({
      where: includeUnresolved
        ? {}
        : {
            status: {
              not: 'failed'
            }
          },
      orderBy: {
        created_at: 'desc'
      },
      take: 50
    })
  ]);

  const allowedNodeIds = rootId
    ? getNeighborhoodNodeIds(rootId, depth, relationships, atmosphereNodes, actionIntents)
    : null;

  let nodes: GraphNodeView[] = [];

  if (kinds === null || kinds.includes('agent')) {
    for (const agent of agents) {
      if (allowedNodeIds && !allowedNodeIds.has(agent.id)) {
        continue;
      }

      nodes.push({
        id: agent.id,
        kind: 'agent',
        label: agent.name,
        render_type: 'avatar',
        display: {
          avatar_url: null,
          image_url: null,
          icon: agent.type === 'system' ? 'shield' : agent.type === 'noise' ? 'noise' : 'agent',
          accent_token: agent.is_pinned ? 'graph.agent.pinned' : 'graph.agent.default'
        },
        state: {
          is_pinned: agent.is_pinned,
          activity_status: agent.type === 'active' ? 'active' : agent.type === 'system' ? 'idle' : 'inactive'
        },
        refs: {
          agent_id: agent.id,
          atmosphere_node_id: null,
          source_action_intent_id: null,
          source_event_id: null,
          source_inference_id: null,
          merged_into_node_id: null
        },
        metadata: {
          type: agent.type,
          snr: agent.snr,
          is_pinned: agent.is_pinned,
          created_at: agent.created_at.toString(),
          updated_at: agent.updated_at.toString()
        }
      });
    }
  }

  if (kinds === null || kinds.includes('atmosphere')) {
    for (const node of atmosphereNodes) {
      if (allowedNodeIds && !allowedNodeIds.has(node.id)) {
        continue;
      }

      nodes.push({
        id: node.id,
        kind: 'atmosphere',
        label: node.name,
        render_type: 'chip',
        display: {
          avatar_url: null,
          image_url: null,
          icon: 'atmosphere',
          accent_token: 'graph.atmosphere.default'
        },
        state: {
          is_pinned: false,
          activity_status: node.expires_at !== null && node.expires_at <= now ? 'inactive' : 'idle'
        },
        refs: {
          atmosphere_node_id: node.id,
          agent_id: node.owner_id,
          source_action_intent_id: null,
          source_event_id: null,
          source_inference_id: null,
          merged_into_node_id: null
        },
        metadata: {
          owner_id: node.owner_id,
          expires_at: node.expires_at?.toString() ?? null,
          created_at: node.created_at.toString()
        }
      });
    }
  }

  if (kinds === null || kinds.includes('relay')) {
    for (const intent of actionIntents) {
      if (intent.intent_type !== 'post_message' && intent.status !== 'dropped') {
        continue;
      }

      const relayNodeId = buildRelayNodeId(intent.id);
      const actorAgentId = isRecord(intent.actor_ref) && typeof intent.actor_ref.agent_id === 'string'
        ? intent.actor_ref.agent_id
        : null;
      if (allowedNodeIds && !allowedNodeIds.has(relayNodeId) && !(actorAgentId && allowedNodeIds.has(actorAgentId))) {
        continue;
      }

      nodes.push({
        id: relayNodeId,
        kind: 'relay',
        label: intent.intent_type === 'post_message' ? 'Transmission Relay' : 'Dispatch Relay',
        render_type: 'relay',
        display: {
          avatar_url: null,
          image_url: null,
          icon: 'relay',
          accent_token: intent.status === 'dropped' ? 'graph.relay.dropped' : 'graph.relay.active'
        },
        state: {
          is_pinned: false,
          activity_status: intent.status === 'completed' ? 'active' : intent.status === 'dropped' ? 'inactive' : 'idle',
          lifecycle_status: intent.status === 'dropped' ? 'gc_candidate' : 'active'
        },
        refs: {
          agent_id: actorAgentId,
          atmosphere_node_id: null,
          source_action_intent_id: intent.id,
          source_event_id: null,
          source_inference_id: intent.source_inference_id,
          merged_into_node_id: null
        },
        metadata: {
          relay_type: buildRelayType(intent.intent_type),
          intent_type: intent.intent_type,
          transmission_policy: intent.transmission_policy,
          transmission_delay_ticks: intent.transmission_delay_ticks?.toString() ?? null,
          transmission_drop_chance: intent.transmission_drop_chance,
          drop_reason: intent.drop_reason,
          created_at: intent.created_at.toString(),
          updated_at: intent.updated_at.toString()
        }
      });
    }
  }

  if ((kinds === null || kinds.includes('container')) && includeUnresolved) {
    for (const intent of actionIntents) {
      if (intent.status !== 'failed') {
        continue;
      }

      const containerNodeId = buildContainerNodeId(intent.id);
      const actorAgentId = isRecord(intent.actor_ref) && typeof intent.actor_ref.agent_id === 'string'
        ? intent.actor_ref.agent_id
        : null;
      if (allowedNodeIds && !allowedNodeIds.has(containerNodeId) && !(actorAgentId && allowedNodeIds.has(actorAgentId))) {
        continue;
      }

      nodes.push({
        id: containerNodeId,
        kind: 'container',
        label: intent.dispatch_error_code ?? 'Unresolved Intent',
        render_type: 'blackbox',
        display: {
          avatar_url: null,
          image_url: null,
          icon: 'container',
          accent_token: 'graph.container.default'
        },
        state: {
          is_pinned: false,
          activity_status: 'unknown',
          resolve_state: 'open',
          lifecycle_status: 'sealed'
        },
        refs: {
          agent_id: actorAgentId,
          atmosphere_node_id: null,
          source_action_intent_id: intent.id,
          source_event_id: null,
          source_inference_id: intent.source_inference_id,
          merged_into_node_id: null
        },
        metadata: {
          container_type: buildContainerType(intent),
          intent_type: intent.intent_type,
          dispatch_error_code: intent.dispatch_error_code,
          dispatch_error_message: intent.dispatch_error_message,
          created_at: intent.created_at.toString(),
          updated_at: intent.updated_at.toString()
        }
      });
    }
  }

  nodes = nodes.filter(node => matchesSearch(node, search));

  const nodeIds = new Set(nodes.map(node => node.id));
  const relationshipEdges: GraphEdgeView[] = relationships
    .filter(relationship => {
      if (allowedNodeIds) {
        return allowedNodeIds.has(relationship.from_id) && allowedNodeIds.has(relationship.to_id);
      }

      return true;
    })
    .filter(relationship => nodeIds.has(relationship.from_id) && nodeIds.has(relationship.to_id))
    .map(relationship => ({
      id: relationship.id,
      source: relationship.from_id,
      target: relationship.to_id,
      kind: 'relationship',
      label: relationship.type,
      weight: relationship.weight,
      refs: {
        relationship_id: relationship.id,
        action_intent_id: null,
        event_id: null
      },
      metadata: {
        type: relationship.type,
        created_at: relationship.created_at.toString(),
        updated_at: relationship.updated_at.toString()
      }
    }));

  const ownershipEdges: GraphEdgeView[] = atmosphereNodes
    .filter(node => {
      if (allowedNodeIds) {
        return allowedNodeIds.has(node.id) && allowedNodeIds.has(node.owner_id);
      }

      return true;
    })
    .filter(node => nodeIds.has(node.id) && nodeIds.has(node.owner_id))
    .map(node => ({
      id: `ownership:${node.owner_id}:${node.id}`,
      source: node.owner_id,
      target: node.id,
      kind: 'ownership',
      label: 'owns',
      weight: 1,
      refs: {
        relationship_id: null,
        action_intent_id: null,
        event_id: null
      },
      metadata: {
        owner_id: node.owner_id,
        atmosphere_node_id: node.id
      }
    }));

  const transmissionEdges: GraphEdgeView[] = actionIntents.flatMap(intent => {
    const actorAgentId = isRecord(intent.actor_ref) && typeof intent.actor_ref.agent_id === 'string'
      ? intent.actor_ref.agent_id
      : null;
    const relayNodeId = buildRelayNodeId(intent.id);

    if (!actorAgentId || !nodeIds.has(actorAgentId) || !nodeIds.has(relayNodeId)) {
      return [];
    }

    return [{
      id: `transmission:${actorAgentId}:${relayNodeId}`,
      source: actorAgentId,
      target: relayNodeId,
      kind: 'transmission',
      label: intent.intent_type,
      weight: 1,
      refs: {
        relationship_id: null,
        action_intent_id: intent.id,
        event_id: null
      },
      metadata: {
        intent_type: intent.intent_type,
        transmission_policy: intent.transmission_policy,
        drop_reason: intent.drop_reason
      }
    }];
  });

  const derivedEdges: GraphEdgeView[] = actionIntents.flatMap(intent => {
    const sourceNodeId = buildContainerNodeId(intent.id);
    const targetNodeId = buildRelayNodeId(intent.id);

    if (!nodeIds.has(sourceNodeId) || !nodeIds.has(targetNodeId)) {
      return [];
    }

    return [{
      id: `derived:${sourceNodeId}:${targetNodeId}`,
      source: sourceNodeId,
      target: targetNodeId,
      kind: 'derived_from',
      label: 'derived_from',
      weight: 1,
      refs: {
        relationship_id: null,
        action_intent_id: intent.id,
        event_id: null
      },
      metadata: {
        source_inference_id: intent.source_inference_id
      }
    }];
  });

  const edges = [...relationshipEdges, ...ownershipEdges, ...transmissionEdges, ...derivedEdges];

  const countsByKind = nodes.reduce<Record<string, number>>((acc, node) => {
    acc[node.kind] = (acc[node.kind] ?? 0) + 1;
    return acc;
  }, {});

  return {
    schema_version: 'graph-v2',
    view,
    nodes,
    edges,
    summary: {
      counts_by_kind: countsByKind,
      active_root_ids: activeBindings
        .map(binding => binding.agent_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
      returned_node_count: nodes.length,
      returned_edge_count: edges.length,
      applied_filters: {
        kinds: kinds ? [...kinds] : null,
        root_id: rootId,
        depth,
        include_inactive: includeInactive,
        include_unresolved: includeUnresolved,
        search
      }
    }
  };
};

export const listRelationalCircles = async (context: AppContext) => {
  return context.sim.prisma.circle.findMany({
    include: { members: true }
  });
};

export const listAtmosphereNodes = async (
  context: AppContext,
  input: ListAtmosphereNodesInput
) => {
  const ownerId = typeof input.owner_id === 'string' ? input.owner_id.trim() : '';
  const includeExpired = input.include_expired === true;
  const now = context.sim.clock.getTicks();

  return context.sim.prisma.atmosphereNode.findMany({
    where: {
      ...(ownerId.length === 0 ? {} : { owner_id: ownerId }),
      ...(includeExpired
        ? {}
        : {
            OR: [{ expires_at: null }, { expires_at: { gt: now } }]
          })
    },
    orderBy: { created_at: 'desc' }
  });
};

export const listRelationshipAdjustmentLogs = async (
  context: AppContext,
  input: ListRelationshipAdjustmentLogsInput
) => {
  const fromId = typeof input.from_id === 'string' ? input.from_id.trim() : '';
  const toId = typeof input.to_id === 'string' ? input.to_id.trim() : '';
  const relationshipType = typeof input.type === 'string' ? input.type.trim() : '';

  if (fromId.length === 0 || toId.length === 0 || relationshipType.length === 0) {
    throw new ApiError(400, 'RELATIONSHIP_LOG_QUERY_INVALID', 'from_id, to_id, and type are required');
  }

  const requestedLimit = typeof input.limit === 'number' && Number.isFinite(input.limit)
    ? Math.trunc(input.limit)
    : DEFAULT_RELATIONSHIP_LOG_LIMIT;
  const limit = Math.min(MAX_RELATIONSHIP_LOG_LIMIT, Math.max(1, requestedLimit));

  return context.prisma.relationshipAdjustmentLog.findMany({
    where: {
      from_id: fromId,
      to_id: toId,
      type: relationshipType
    },
    orderBy: {
      created_at: 'desc'
    },
    take: limit
  });
};
