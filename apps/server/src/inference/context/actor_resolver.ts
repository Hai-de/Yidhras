import type { IdentityContext } from '../../identity/types.js';
import type { WorldPack } from '../../packs/manifest/constitution_loader.js';
import { ApiError } from '../../utils/api_error.js';
import { toAgentSnapshot } from '../mappers.js';
import type { InferenceRequestInput } from '../types.js';
import type { ResolvedActor } from './types.js';

// ── Context ──────────────────────────────────────────────────

export interface ActorResolutionContext {
  repos: {
    agent: {
      findAgentById(id: string): Promise<{ id: string; name: string; type: string; snr: number; is_pinned: boolean } | null>;
      findAgentByIdWithCircles(id: string): Promise<Record<string, unknown> | null>;
    };
    identityOperator: {
      findIdentityById(id: string): Promise<IdentityContext | null>;
      listIdentityBindings(params: {
        where: { identity_id: string; status: string };
        include: { identity: boolean; atmosphere_node: { select: { id: boolean; name: boolean; owner_id: boolean } } };
        orderBy: { created_at: string };
      }): Promise<Array<{
        id: string;
        role: string;
        status: string;
        agent_id: string | null;
        atmosphere_node_id: string | null;
        identity: { id: string; type: string; name: string | null; provider: string; status: string; claims: unknown };
        atmosphere_node: { id: string; name: string; owner_id: string } | null;
      }>>;
      findActiveBindingForAgent(agentId: string): Promise<{
        id: string;
        role: string;
        status: string;
        agent_id: string | null;
        atmosphere_node_id: string | null;
        identity: { id: string; type: string; name: string | null; provider: string; status: string; claims: unknown } | null;
      } | null>;
    };
  };
  getPackRuntimeHost?(packId: string): { getPack(): WorldPack | undefined } | null;
}

// ── Strategy interface ──────────────────────────────────────

export interface ActorResolutionStrategy {
  canHandle(input: InferenceRequestInput): boolean;
  resolve(ctx: ActorResolutionContext, input: InferenceRequestInput, packId?: string): Promise<ResolvedActor>;
}

// ── Agent ID strategy ───────────────────────────────────────

const AgentIdStrategy: ActorResolutionStrategy = {
  canHandle(input) {
    return Boolean(input.agent_id);
  },

  async resolve(ctx, input, _packId) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- canHandle guarantees agent_id presence
    const agentId = input.agent_id!;
    const agent = await ctx.repos.agent.findAgentByIdWithCircles(agentId);

    if (!agent) {
      throw new ApiError(404, 'AGENT_NOT_FOUND', 'Agent not found', { agent_id: agentId });
    }

    const identity: IdentityContext = {
      id: typeof agent['id'] === 'string' ? agent['id'] : '',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated as string above
      type: (typeof agent['type'] === 'string' ? agent['type'] : 'agent') as IdentityContext['type'],
      name: typeof agent['name'] === 'string' ? agent['name'] : null,
      provider: typeof agent['provider'] === 'string' ? agent['provider'] : undefined,
      status: typeof agent['status'] === 'string' ? agent['status'] : undefined,
      claims: null
    };

    return {
      identity,
      actor_ref: {
        identity_id: identity.id,
        identity_type: identity.type,
        role: 'active',
        agent_id: agentId,
        atmosphere_node_id: null
      },
      actor_display_name: identity.name ?? agentId,
      binding_ref: null,
      resolved_agent_id: agentId,
      agent_snapshot: toAgentSnapshot(agent)
    };
  }
};

// ── Identity ID strategy ────────────────────────────────────

const toBindingIdentityContext = (
  binding: {
    identity: { id: string; type: string; name: string | null; provider: string; status: string; claims: unknown } | null
  }
): IdentityContext => ({
  id: binding.identity?.id ?? '',
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- runtime cast of DB value
  type: (binding.identity?.type as IdentityContext['type']) ?? 'noise',
  name: binding.identity?.name ?? '',
  provider: binding.identity?.provider ?? undefined,
  status: binding.identity?.status ?? undefined,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- DB value typed at boundary
  claims: binding.identity?.claims as Record<string, unknown> | null ?? null
});

const IdentityIdStrategy: ActorResolutionStrategy = {
  canHandle(input) {
    return Boolean(input.identity_id) && !input.agent_id;
  },

  async resolve(ctx, input, _packId) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- canHandle guarantees identity_id presence
    const identityId = input.identity_id!;
    const identity = await ctx.repos.identityOperator.findIdentityById(identityId);

    if (!identity) {
      throw new ApiError(404, 'IDENTITY_NOT_FOUND', 'Identity not found', { identity_id: identityId });
    }

    const bindings = await ctx.repos.identityOperator.listIdentityBindings({
      where: { identity_id: identityId, status: 'active' },
      include: {
        identity: true,
        atmosphere_node: { select: { id: true, name: true, owner_id: true } }
      },
      orderBy: { created_at: 'desc' }
    });

    const binding = bindings[0] ?? null;

    // Sub-path 1: identity is bound to an agent
    if (binding?.agent_id) {
      const boundAgent = await ctx.repos.agent.findAgentByIdWithCircles(binding.agent_id);
      return {
        identity,
        actor_ref: {
          identity_id: identity.id,
          identity_type: identity.type,
          role: binding.role === 'atmosphere' ? 'atmosphere' : 'active',
          agent_id: binding.agent_id,
          atmosphere_node_id: binding.atmosphere_node_id
        },
        actor_display_name: identity.name ?? binding.agent_id,
        binding_ref: {
          binding_id: binding.id,
          role: (binding.role === 'atmosphere' ? 'atmosphere' : 'active'),
          status: binding.status,
          agent_id: binding.agent_id,
          atmosphere_node_id: binding.atmosphere_node_id
        },
        resolved_agent_id: binding.agent_id,
        agent_snapshot: toAgentSnapshot(boundAgent ?? {})
      };
    }

    // Sub-path 2: identity has atmosphere binding only
    if (binding?.atmosphere_node) {
      return {
        identity,
        actor_ref: {
          identity_id: identity.id,
          identity_type: identity.type,
          role: 'atmosphere',
          agent_id: null,
          atmosphere_node_id: binding.atmosphere_node.id
        },
        actor_display_name: binding.atmosphere_node.name,
        binding_ref: {
          binding_id: binding.id,
          role: 'atmosphere',
          status: binding.status,
          agent_id: binding.agent_id,
          atmosphere_node_id: binding.atmosphere_node_id
        },
        resolved_agent_id: null,
        agent_snapshot: null
      };
    }

    // Sub-path 3: identity without any binding
    return {
      identity,
      actor_ref: {
        identity_id: identity.id,
        identity_type: identity.type,
        role: 'active',
        agent_id: null,
        atmosphere_node_id: null
      },
      actor_display_name: identity.name ?? identity.id,
      binding_ref: null,
      resolved_agent_id: null,
      agent_snapshot: null
    };
  }
};

// ── Actor Entity ID strategy ────────────────────────────────

const ActorEntityIdStrategy: ActorResolutionStrategy = {
  canHandle(input) {
    return Boolean(input.actor_entity_id) && !input.agent_id && !input.identity_id;
  },

  async resolve(ctx, input, packId) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- canHandle guarantees presence
    const entityId = input.actor_entity_id!;
    if (!packId) {
      throw new ApiError(400, 'ACTOR_ENTITY_MISSING_PACK', 'actor_entity_id requires pack_id');
    }

    const bridgedAgentId = `${packId}:${entityId}`;
    const agent = await ctx.repos.agent.findAgentById(bridgedAgentId);

    if (!agent) {
      throw new ApiError(404, 'ACTOR_ENTITY_NOT_FOUND', 'Pack actor entity not found', {
        actor_entity_id: entityId,
        pack_id: packId
      });
    }

    const pack = ctx.getPackRuntimeHost?.(packId)?.getPack();
    const actorDef = pack?.entities?.actors?.find(a => a.id === entityId);
    const entityKind = actorDef?.kind ?? 'actor';

    const binding = await ctx.repos.identityOperator.findActiveBindingForAgent(bridgedAgentId);

    const identity: IdentityContext = binding
      ? toBindingIdentityContext(binding)
      : {
          id: `${packId}:identity:${entityId}`,
          type: 'agent',
          name: agent.name,
          provider: 'pack',
          status: 'active',
          claims: null
        };

    return {
      identity,
      actor_ref: {
        identity_id: identity.id,
        identity_type: identity.type,
        entity_kind: entityKind,
        role: 'active',
        agent_id: bridgedAgentId,
        atmosphere_node_id: null
      },
      actor_display_name: agent.name ?? entityId,
      binding_ref: binding
        ? {
            binding_id: binding.id,
            role: 'active',
            status: binding.status,
            agent_id: binding.agent_id,
            atmosphere_node_id: binding.atmosphere_node_id
          }
        : null,
      resolved_agent_id: bridgedAgentId,
      agent_snapshot: {
        id: agent.id,
        name: agent.name ?? '',
        type: agent.type,
        snr: agent.snr,
        is_pinned: agent.is_pinned
      }
    };
  }
};

// ── System fallback strategy ─────────────────────────────────

const SystemFallbackStrategy: ActorResolutionStrategy = {
  canHandle() {
    return true;
  },

  async resolve(ctx, _input, _packId) {
    const systemIdentity = await ctx.repos.identityOperator.findIdentityById('system');

    if (!systemIdentity) {
      throw new ApiError(500, 'SYSTEM_IDENTITY_MISSING', 'System identity is not configured');
    }

    return {
      identity: systemIdentity,
      actor_ref: {
        identity_id: systemIdentity.id,
        identity_type: systemIdentity.type,
        role: 'active',
        agent_id: null,
        atmosphere_node_id: null
      },
      actor_display_name: systemIdentity.name ?? 'system',
      binding_ref: null,
      resolved_agent_id: null,
      agent_snapshot: null
    };
  }
};

// ── Resolver ─────────────────────────────────────────────────

const STRATEGIES: ActorResolutionStrategy[] = [
  AgentIdStrategy,
  IdentityIdStrategy,
  ActorEntityIdStrategy,
  SystemFallbackStrategy
];

export const resolveActor = async (
  ctx: ActorResolutionContext,
  input: InferenceRequestInput,
  packId?: string
): Promise<ResolvedActor> => {
  for (const strategy of STRATEGIES) {
    if (strategy.canHandle(input)) {
      return strategy.resolve(ctx, input, packId);
    }
  }

  // Unreachable: SystemFallbackStrategy always returns true
  throw new ApiError(500, 'ACTOR_RESOLUTION_FAILED', 'No strategy could resolve actor');
};
