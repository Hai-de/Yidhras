import type { AppContext } from '../../context.js';
import { parseGraphViewFilters } from './graph_filters.js';
import { buildContainerNodeId, buildRelayNodeId, getNeighborhoodNodeIds } from './graph_traversal.js';
import type { GraphEdgeView, GraphNodeView, GraphViewInput, GraphViewSnapshot } from './types.js';
import { isRecord } from './types.js';

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

export const getGraphView = async (
  context: AppContext,
  input: GraphViewInput
): Promise<GraphViewSnapshot> => {
  const filters = parseGraphViewFilters(input);
  const now = context.clock.getCurrentTick();

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
      where: filters.includeInactive
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
      where: filters.includeUnresolved
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

  const allowedNodeIds = filters.rootId
    ? getNeighborhoodNodeIds(filters.rootId, filters.depth, relationships, atmosphereNodes, actionIntents)
    : null;

  let nodes: GraphNodeView[] = [];

  if (filters.kinds === null || filters.kinds.includes('agent')) {
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

  if (filters.kinds === null || filters.kinds.includes('atmosphere')) {
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

  if (filters.kinds === null || filters.kinds.includes('relay')) {
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

  if ((filters.kinds === null || filters.kinds.includes('container')) && filters.includeUnresolved) {
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

  nodes = nodes.filter(node => matchesSearch(node, filters.search));

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
    view: filters.view,
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
        kinds: filters.kinds ? [...filters.kinds] : null,
        root_id: filters.rootId,
        depth: filters.depth,
        include_inactive: filters.includeInactive,
        include_unresolved: filters.includeUnresolved,
        search: filters.search
      }
    }
  };
};
