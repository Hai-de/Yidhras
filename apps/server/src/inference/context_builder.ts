import { randomUUID } from 'node:crypto';

import type { AppContext } from '../app/context.js';
import { getAgentContextSnapshot } from '../app/services/agent.js';
import { IdentityPolicyService } from '../identity/service.js';
import type { IdentityContext } from '../identity/types.js';
import { createMemoryService } from '../memory/service.js';
import type { VariablePool } from '../narrative/types.js';
import { listPackEntityStateProjectionRecords } from '../packs/storage/entity_state_projection.js';
import { ApiError } from '../utils/api_error.js';
import type {
  InferenceActorRef,
  InferenceAgentSnapshot,
  InferenceBindingRef,
  InferenceContext,
  InferencePackArtifactSnapshot,
  InferencePackRuntimeContract,
  InferencePackStateRecord,
  InferencePackStateSnapshot,
  InferencePolicySummary,
  InferenceRequestInput,
  InferenceStrategy,
  InferenceTransmissionProfile
} from './types.js';

const SUPPORTED_STRATEGIES: InferenceStrategy[] = ['mock', 'rule_based'];
const DEFAULT_PACK_WORLD_ENTITY_ID = '__world__';

interface BindingRecord {
  id: string;
  role: string;
  status: string;
  agent_id: string | null;
  atmosphere_node_id: string | null;
  identity: {
    id: string;
    type: string;
    name: string | null;
    provider: string;
    status: string;
    claims: unknown;
  };
  atmosphere_node: {
    id: string;
    name: string;
    owner_id: string;
  } | null;
}

interface ResolvedActor {
  identity: IdentityContext;
  actorRef: InferenceActorRef;
  actorDisplayName: string;
  bindingRef: InferenceBindingRef | null;
  resolvedAgentId: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const toIdentityContext = (identity: {
  id: string;
  type: string;
  name: string | null;
  provider: string | null;
  status: string | null;
  claims: unknown;
}): IdentityContext => {
  return {
    id: identity.id,
    type: identity.type as IdentityContext['type'],
    name: identity.name,
    provider: identity.provider,
    status: identity.status,
    claims: (identity.claims as Record<string, unknown> | null | undefined) ?? null
  };
};

const toBindingRef = (binding: BindingRecord): InferenceBindingRef => {
  return {
    binding_id: binding.id,
    role: binding.role as InferenceBindingRef['role'],
    status: binding.status,
    agent_id: binding.agent_id,
    atmosphere_node_id: binding.atmosphere_node_id
  };
};

const selectStrategy = (input: InferenceRequestInput): InferenceStrategy => {
  if (!input.strategy) {
    return 'mock';
  }

  if (!SUPPORTED_STRATEGIES.includes(input.strategy as InferenceStrategy)) {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'strategy is not supported', {
      allowed_strategies: SUPPORTED_STRATEGIES,
      strategy: input.strategy
    });
  }

  return input.strategy as InferenceStrategy;
};

const normalizeAttributes = (value: unknown): Record<string, unknown> => {
  if (value === undefined) {
    return {};
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'attributes must be an object');
  }

  return value as Record<string, unknown>;
};

const createIdentityPolicyService = (context: AppContext): IdentityPolicyService => {
  return new IdentityPolicyService(context.prisma);
};

const listActiveBindingsForIdentity = async (context: AppContext, identityId: string): Promise<BindingRecord[]> => {
  return context.prisma.identityNodeBinding.findMany({
    where: {
      identity_id: identityId,
      status: 'active'
    },
    include: {
      identity: true,
      atmosphere_node: {
        select: {
          id: true,
          name: true,
          owner_id: true
        }
      }
    },
    orderBy: { created_at: 'desc' }
  }) as Promise<BindingRecord[]>;
};

const resolveIdentityOnlyActor = async (context: AppContext, identityId: string): Promise<ResolvedActor> => {
  const identityService = createIdentityPolicyService(context);
  const identity = await identityService.fetchIdentity(identityId);
  if (!identity) {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'identity_id could not be resolved', {
      identity_id: identityId
    });
  }

  const bindings = await listActiveBindingsForIdentity(context, identityId);
  const activeBinding = bindings.find(binding => binding.role === 'active' && binding.agent_id);
  const atmosphereBinding = bindings.find(
    binding => binding.role === 'atmosphere' && binding.atmosphere_node_id && binding.atmosphere_node?.owner_id
  );
  const binding = activeBinding ?? atmosphereBinding;

  if (!binding && (identity.id === 'system' || identity.type === 'system')) {
    return {
      identity,
      actorRef: {
        identity_id: identity.id,
        identity_type: identity.type,
        role: 'active',
        agent_id: null,
        atmosphere_node_id: null
      },
      actorDisplayName: identity.name ?? identity.id,
      bindingRef: null,
      resolvedAgentId: null
    };
  }

  if (!binding) {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'identity_id has no active binding', {
      identity_id: identityId
    });
  }

  if (binding.role === 'active') {
    return {
      identity,
      actorRef: {
        identity_id: identity.id,
        identity_type: identity.type,
        role: 'active',
        agent_id: binding.agent_id,
        atmosphere_node_id: null
      },
      actorDisplayName: binding.identity.name ?? binding.agent_id ?? identity.id,
      bindingRef: toBindingRef(binding),
      resolvedAgentId: binding.agent_id
    };
  }

  return {
    identity,
    actorRef: {
      identity_id: identity.id,
      identity_type: identity.type,
      role: 'atmosphere',
      agent_id: binding.atmosphere_node?.owner_id ?? null,
      atmosphere_node_id: binding.atmosphere_node_id
    },
    actorDisplayName: binding.atmosphere_node?.name ?? binding.identity.name ?? identity.id,
    bindingRef: toBindingRef(binding),
    resolvedAgentId: binding.atmosphere_node?.owner_id ?? null
  };
};

const resolveAgentOnlyActor = async (context: AppContext, agentId: string): Promise<ResolvedActor> => {
  const bindings = (await context.prisma.identityNodeBinding.findMany({
    where: {
      agent_id: agentId,
      role: 'active',
      status: 'active'
    },
    include: {
      identity: true,
      atmosphere_node: {
        select: {
          id: true,
          name: true,
          owner_id: true
        }
      }
    },
    orderBy: { created_at: 'desc' }
  })) as BindingRecord[];

  if (bindings.length === 0) {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'agent_id has no active binding', {
      agent_id: agentId
    });
  }

  if (bindings.length > 1) {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'agent_id resolves to multiple active bindings', {
      agent_id: agentId,
      binding_ids: bindings.map(binding => binding.id)
    });
  }

  const binding = bindings[0];
  const identity = toIdentityContext(binding.identity);

  return {
    identity,
    actorRef: {
      identity_id: identity.id,
      identity_type: identity.type,
      role: 'active',
      agent_id: binding.agent_id,
      atmosphere_node_id: null
    },
    actorDisplayName: binding.identity.name ?? binding.agent_id ?? identity.id,
    bindingRef: toBindingRef(binding),
    resolvedAgentId: binding.agent_id
  };
};

const resolveExplicitActor = async (
  context: AppContext,
  agentId: string,
  identityId: string
): Promise<ResolvedActor> => {
  const identityService = createIdentityPolicyService(context);
  const identity = await identityService.fetchIdentity(identityId);
  if (!identity) {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'identity_id could not be resolved', {
      identity_id: identityId
    });
  }

  const bindings = await listActiveBindingsForIdentity(context, identityId);
  const matchingActiveBinding = bindings.find(binding => binding.role === 'active' && binding.agent_id === agentId);
  if (matchingActiveBinding) {
    return {
      identity,
      actorRef: {
        identity_id: identity.id,
        identity_type: identity.type,
        role: 'active',
        agent_id: matchingActiveBinding.agent_id,
        atmosphere_node_id: null
      },
      actorDisplayName: matchingActiveBinding.identity.name ?? matchingActiveBinding.agent_id ?? identity.id,
      bindingRef: toBindingRef(matchingActiveBinding),
      resolvedAgentId: matchingActiveBinding.agent_id
    };
  }

  const matchingAtmosphereBinding = bindings.find(
    binding => binding.role === 'atmosphere' && binding.atmosphere_node?.owner_id === agentId
  );
  if (matchingAtmosphereBinding) {
    return {
      identity,
      actorRef: {
        identity_id: identity.id,
        identity_type: identity.type,
        role: 'atmosphere',
        agent_id: matchingAtmosphereBinding.atmosphere_node?.owner_id ?? null,
        atmosphere_node_id: matchingAtmosphereBinding.atmosphere_node_id
      },
      actorDisplayName:
        matchingAtmosphereBinding.atmosphere_node?.name ?? matchingAtmosphereBinding.identity.name ?? identity.id,
      bindingRef: toBindingRef(matchingAtmosphereBinding),
      resolvedAgentId: matchingAtmosphereBinding.atmosphere_node?.owner_id ?? null
    };
  }

  throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'agent_id and identity_id do not resolve to the same active actor', {
    agent_id: agentId,
    identity_id: identityId
  });
};

const resolveActor = async (context: AppContext, input: InferenceRequestInput): Promise<ResolvedActor> => {
  const agentId = input.agent_id?.trim();
  const identityId = input.identity_id?.trim();

  if (!agentId && !identityId) {
    throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'Either agent_id or identity_id is required');
  }

  if (agentId && identityId) {
    return resolveExplicitActor(context, agentId, identityId);
  }

  if (identityId) {
    return resolveIdentityOnlyActor(context, identityId);
  }

  return resolveAgentOnlyActor(context, agentId!);
};

const buildAgentSnapshot = (
  identity: Record<string, unknown> | null | undefined
): InferenceAgentSnapshot | null => {
  if (!identity) {
    return null;
  }

  const id = typeof identity.id === 'string' ? identity.id : null;
  const name = typeof identity.name === 'string' ? identity.name : null;
  const type = typeof identity.type === 'string' ? identity.type : null;
  const snr = typeof identity.snr === 'number' ? identity.snr : null;
  const isPinned = typeof identity.is_pinned === 'boolean' ? identity.is_pinned : null;

  if (!id || !name || !type || snr === null || isPinned === null) {
    return null;
  }

  return {
    id,
    name,
    type,
    snr,
    is_pinned: isPinned
  };
};

const normalizePackStateRecord = (value: unknown): InferencePackStateRecord => {
  if (!isRecord(value)) {
    return {};
  }

  return value as InferencePackStateRecord;
};

const buildPackStateSnapshot = async (
  _context: AppContext,
  packId: string,
  resolvedAgentId: string | null,
  attributes: Record<string, unknown>
): Promise<InferencePackStateSnapshot> => {
  const states = await listPackEntityStateProjectionRecords(packId);

  const actorState = resolvedAgentId
    ? states.find(state => state.entity_id === resolvedAgentId && state.state_namespace === 'core') ?? null
    : null;

  const artifactStates = states.filter(state => state.state_namespace === 'core' && state.entity_id.startsWith('artifact-'));
  const ownedArtifacts: InferencePackArtifactSnapshot[] = resolvedAgentId
    ? artifactStates
        .filter(state => state.state_json.holder_agent_id === resolvedAgentId)
        .map(state => ({
          id: state.entity_id,
          state: normalizePackStateRecord(state.state_json)
        }))
    : [];

  const worldState =
    states.find(state => state.entity_id === DEFAULT_PACK_WORLD_ENTITY_ID && state.state_namespace === 'world') ?? null;

  return {
    actor_roles: actorState && Array.isArray(actorState.state_json.roles)
      ? actorState.state_json.roles.filter((value): value is string => typeof value === 'string')
      : [],
    actor_state: actorState ? normalizePackStateRecord(actorState.state_json) : null,
    owned_artifacts: ownedArtifacts,
    world_state: worldState ? normalizePackStateRecord(worldState.state_json) : null,
    latest_event: typeof attributes.latest_event_semantic_type === 'string'
      ? {
          event_id: 'synthetic-latest-event',
          title: String(attributes.latest_event_semantic_type),
          type: 'history',
          semantic_type: attributes.latest_event_semantic_type,
          created_at: _context.sim.getCurrentTick().toString()
        }
      : null
  };
};

const buildPackRuntimeContract = (_context: AppContext): InferencePackRuntimeContract => {
  return {};
};

const buildPolicySummary = async (
  context: AppContext,
  identity: IdentityContext,
  attributes: Record<string, unknown>
): Promise<InferencePolicySummary> => {
  const service = createIdentityPolicyService(context);
  const readInput = {
    identity,
    resource: 'social_post',
    action: 'read',
    attributes
  };
  const writeInput = {
    identity,
    resource: 'social_post',
    action: 'write',
    attributes
  };
  const readableFields = ['id', 'author_id', 'content', 'created_at'];
  const writableFields = ['content'];

  const readResult = await service.evaluateFields(readInput, readableFields);
  const writeResult = await service.evaluateFields(writeInput, writableFields);

  return {
    social_post_read_allowed: readResult.allowedFields.size > 0,
    social_post_readable_fields: Array.from(readResult.allowedFields),
    social_post_write_allowed: writeResult.allowedFields.has('content'),
    social_post_writable_fields: Array.from(writeResult.allowedFields)
  };
};

const buildTransmissionProfile = (
  actorRef: InferenceContext['actor_ref'],
  agentSnapshot: InferenceAgentSnapshot | null,
  policySummary: InferencePolicySummary,
  attributes: Record<string, unknown>
): InferenceTransmissionProfile => {
  const derivedFrom: string[] = [];

  if (typeof attributes.transmission_policy === 'string') {
    const policy = attributes.transmission_policy;
    if (policy === 'reliable' || policy === 'best_effort' || policy === 'fragile' || policy === 'blocked') {
      derivedFrom.push('attributes.transmission_policy');
      return {
        policy,
        drop_reason: policy === 'blocked' ? 'policy_blocked' : null,
        delay_ticks: typeof attributes.transmission_delay_ticks === 'string' ? attributes.transmission_delay_ticks : '1',
        drop_chance: typeof attributes.transmission_drop_chance === 'number' ? attributes.transmission_drop_chance : policy === 'blocked' ? 1 : 0,
        derived_from: derivedFrom
      };
    }
  }

  if (!policySummary.social_post_write_allowed) {
    return {
      policy: 'blocked',
      drop_reason: 'visibility_denied',
      delay_ticks: '1',
      drop_chance: 1,
      derived_from: ['policy_summary.social_post_write_allowed=false']
    };
  }

  if (actorRef.role === 'atmosphere') {
    derivedFrom.push('actor_ref.role=atmosphere');
    return {
      policy: 'fragile',
      drop_reason: 'low_signal_quality',
      delay_ticks: '2',
      drop_chance: 0.5,
      derived_from: derivedFrom
    };
  }

  if (agentSnapshot && agentSnapshot.snr < 0.4) {
    derivedFrom.push('agent_snapshot.snr<0.4');
    return {
      policy: 'fragile',
      drop_reason: 'low_signal_quality',
      delay_ticks: '2',
      drop_chance: 0.5,
      derived_from: derivedFrom
    };
  }

  return {
    policy: 'reliable',
    drop_reason: null,
    delay_ticks: '1',
    drop_chance: 0,
    derived_from: ['default.reliable']
  };
};

export const buildInferenceContext = async (
  context: AppContext,
  input: InferenceRequestInput
): Promise<InferenceContext> => {
  context.assertRuntimeReady('inference context');

  const pack = context.sim.getActivePack();
  if (!pack) {
    throw new ApiError(503, 'WORLD_PACK_NOT_READY', 'World pack not ready for inference context', {
      startup_level: context.startupHealth.level,
      available_world_packs: context.startupHealth.available_world_packs
    });
  }

  const strategy = selectStrategy(input);
  const attributes = normalizeAttributes(input.attributes);
  const resolvedActor = await resolveActor(context, input);

  let visibleVariables: VariablePool = pack.variables ?? {};
  let agentSnapshot: InferenceAgentSnapshot | null = null;

  if (resolvedActor.resolvedAgentId) {
    const agentContext = await getAgentContextSnapshot(context, resolvedActor.resolvedAgentId);
    visibleVariables = agentContext.variables as VariablePool;
    agentSnapshot = buildAgentSnapshot(agentContext.identity as Record<string, unknown>);
  }

  const packState = await buildPackStateSnapshot(context, pack.metadata.id, resolvedActor.resolvedAgentId, attributes);
  const packRuntime = buildPackRuntimeContract(context);
  const policySummary = await buildPolicySummary(context, resolvedActor.identity, attributes);
  const transmissionProfile = buildTransmissionProfile(resolvedActor.actorRef, agentSnapshot, policySummary, attributes);
  const memoryService = createMemoryService({ context });
  const memoryResult = await memoryService.buildMemoryContext({
    actor_ref: resolvedActor.actorRef,
    resolved_agent_id: resolvedActor.resolvedAgentId
  });

  return {
    inference_id: randomUUID(),
    actor_ref: resolvedActor.actorRef,
    actor_display_name: resolvedActor.actorDisplayName,
    identity: resolvedActor.identity,
    binding_ref: resolvedActor.bindingRef,
    resolved_agent_id: resolvedActor.resolvedAgentId,
    agent_snapshot: agentSnapshot,
    tick: context.sim.getCurrentTick(),
    strategy,
    attributes,
    world_pack: {
      id: pack.metadata.id,
      name: pack.metadata.name,
      version: pack.metadata.version
    },
    world_prompts: pack.prompts ?? {},
    visible_variables: visibleVariables,
    policy_summary: policySummary,
    transmission_profile: transmissionProfile,
    memory_context: memoryResult.context_pack,
    pack_state: packState,
    pack_runtime: packRuntime
  };
};
