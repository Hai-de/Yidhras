import { randomUUID } from 'node:crypto';

import { AccessPolicyService } from '../access_policy/service.js';
import type { AppContext } from '../app/context.js';
import { getAgentContextSnapshot } from '../app/services/agent.js';
import { getActivePackRuntimeFacade } from '../app/services/app_context_ports.js';
import { createContextAssemblyPort } from '../app/services/context_memory_ports.js';
import { getLatestEventEvidenceRecord } from '../app/services/event_evidence_repository.js';
import { createContextService } from '../context/service.js';
import { IdentityService } from '../identity/service.js';
import type { IdentityContext } from '../identity/types.js';
import { createMemoryService } from '../memory/service.js';
import type { PromptVariableContext, VariablePool } from '../narrative/types.js';
import {
  createPromptVariableContext,
  createPromptVariableContextSummary,
  createPromptVariableLayer,
  flattenPromptVariableContextToVisibleVariables,
  normalizePromptVariableRecord
} from '../narrative/variable_context.js';
import { DEFAULT_PACK_WORLD_ENTITY_ID } from '../packs/runtime/core_models.js';
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

const SUPPORTED_STRATEGIES: InferenceStrategy[] = ['mock', 'rule_based', 'model_routed'];

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

const createIdentityService = (context: AppContext): IdentityService => {
  return new IdentityService(context.prisma);
};

const createAccessPolicyService = (context: AppContext): AccessPolicyService => {
  return new AccessPolicyService(context.prisma);
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
    orderBy: {
      created_at: 'desc'
    }
  }) as Promise<BindingRecord[]>;
};

const resolveIdentityById = async (context: AppContext, identityId: string): Promise<IdentityContext | null> => {
  const service = createIdentityService(context);
  return service.fetchIdentity(identityId);
};

const resolveActor = async (context: AppContext, input: InferenceRequestInput): Promise<ResolvedActor> => {
  if (input.agent_id) {
    const agentContext = await getAgentContextSnapshot(context, input.agent_id);
    return {
      identity: agentContext.identity as IdentityContext,
      actorRef: {
        identity_id: agentContext.identity.id,
        identity_type: agentContext.identity.type as IdentityContext['type'],
        role: 'active',
        agent_id: input.agent_id,
        atmosphere_node_id: null
      },
      actorDisplayName: agentContext.identity.name ?? input.agent_id,
      bindingRef: null,
      resolvedAgentId: input.agent_id
    };
  }

  if (input.identity_id) {
    const identity = await resolveIdentityById(context, input.identity_id);
    if (!identity) {
      throw new ApiError(404, 'IDENTITY_NOT_FOUND', 'Identity not found', {
        identity_id: input.identity_id
      });
    }

    const bindings = await listActiveBindingsForIdentity(context, identity.id);
    const binding = bindings[0] ?? null;

    if (binding?.agent_id) {
      return {
        identity,
        actorRef: {
          identity_id: identity.id,
          identity_type: identity.type,
          role: binding.role === 'atmosphere' ? 'atmosphere' : 'active',
          agent_id: binding.agent_id,
          atmosphere_node_id: binding.atmosphere_node_id
        },
        actorDisplayName: identity.name ?? binding.agent_id,
        bindingRef: toBindingRef(binding),
        resolvedAgentId: binding.agent_id
      };
    }

    if (binding?.atmosphere_node) {
      return {
        identity,
        actorRef: {
          identity_id: identity.id,
          identity_type: identity.type,
          role: 'atmosphere',
          agent_id: null,
          atmosphere_node_id: binding.atmosphere_node.id
        },
        actorDisplayName: binding.atmosphere_node.name,
        bindingRef: toBindingRef(binding),
        resolvedAgentId: null
      };
    }

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

  const systemIdentity = await resolveIdentityById(context, 'system');
  if (!systemIdentity) {
    throw new ApiError(500, 'SYSTEM_IDENTITY_MISSING', 'System identity is not configured');
  }

  return {
    identity: systemIdentity,
    actorRef: {
      identity_id: systemIdentity.id,
      identity_type: systemIdentity.type,
      role: 'active',
      agent_id: null,
      atmosphere_node_id: null
    },
    actorDisplayName: systemIdentity.name ?? 'system',
    bindingRef: null,
    resolvedAgentId: null
  };
};

const buildAgentSnapshot = (identity: Record<string, unknown>): InferenceAgentSnapshot => {
  return {
    id: typeof identity.id === 'string' ? identity.id : '',
    name: typeof identity.name === 'string' ? identity.name : '',
    type: typeof identity.type === 'string' ? identity.type : '',
    snr: typeof identity.snr === 'number' ? identity.snr : 0,
    is_pinned: identity.is_pinned === true
  };
};

const buildPolicySummary = async (
  context: AppContext,
  identity: IdentityContext,
  attributes: Record<string, unknown>
): Promise<InferencePolicySummary> => {
  const service = createAccessPolicyService(context);
  const readResult = await service.evaluateFields(
    {
      identity,
      resource: 'social_post',
      action: 'read',
      attributes
    },
    ['id', 'author_id', 'content', 'created_at', 'content.private.preview', 'content.private.raw']
  );
  const writeResult = await service.evaluateFields(
    {
      identity,
      resource: 'social_post',
      action: 'write',
      attributes
    },
    ['content']
  );

  return {
    social_post_read_allowed: readResult.allowedFields.size > 0,
    social_post_readable_fields: Array.from(readResult.allowedFields),
    social_post_write_allowed: writeResult.allowedFields.has('content'),
    social_post_writable_fields: Array.from(writeResult.allowedFields)
  };
};

const buildTransmissionProfile = (
  actorRef: InferenceActorRef,
  agentSnapshot: InferenceAgentSnapshot | null,
  policySummary: InferencePolicySummary,
  attributes: Record<string, unknown>
): InferenceTransmissionProfile => {
  const explicitPolicy = typeof attributes.transmission_policy === 'string' ? attributes.transmission_policy : null;
  const explicitDropChance = typeof attributes.transmission_drop_chance === 'number' ? attributes.transmission_drop_chance : null;
  const explicitDelayTicks =
    typeof attributes.transmission_delay_ticks === 'string' || typeof attributes.transmission_delay_ticks === 'number'
      ? String(attributes.transmission_delay_ticks)
      : null;

  if (explicitPolicy === 'blocked') {
    return {
      policy: 'blocked',
      drop_reason: 'policy_blocked',
      delay_ticks: explicitDelayTicks ?? '0',
      drop_chance: 1,
      derived_from: ['attributes.transmission_policy']
    };
  }

  const actorSNR = agentSnapshot?.snr ?? 0.5;
  const readRestricted = !policySummary.social_post_read_allowed;
  const basePolicy = readRestricted ? 'best_effort' : actorSNR < 0.3 ? 'fragile' : 'reliable';
  const dropChance = explicitDropChance ?? (basePolicy === 'fragile' ? 0.35 : basePolicy === 'best_effort' ? 0.15 : 0);

  return {
    policy:
      explicitPolicy === 'reliable' || explicitPolicy === 'best_effort' || explicitPolicy === 'fragile'
        ? explicitPolicy
        : basePolicy,
    drop_reason: null,
    delay_ticks: explicitDelayTicks ?? '1',
    drop_chance: dropChance,
    derived_from: [
      ...(explicitPolicy ? ['attributes.transmission_policy'] : ['default.reliable']),
      ...(actorRef.role === 'atmosphere' ? ['actor_ref.role'] : []),
      ...(readRestricted ? ['policy_summary.social_post_read_allowed'] : []),
      ...(agentSnapshot ? ['agent_snapshot.snr'] : [])
    ]
  };
};

const parsePackStateRecord = (value: unknown): InferencePackStateRecord => {
  if (!isRecord(value)) {
    return {};
  }

  return value as InferencePackStateRecord;
};

const buildPackStateSnapshot = async (
  context: AppContext,
  packId: string,
  resolvedAgentId: string | null,
  attributes: Record<string, unknown>
): Promise<InferencePackStateSnapshot> => {
  const rows = await listPackEntityStateProjectionRecords(packId);

  let actorState: InferencePackStateRecord | null = null;
  let worldState: InferencePackStateRecord | null = null;
  const artifacts: InferencePackArtifactSnapshot[] = [];

  for (const row of rows) {
    const state = parsePackStateRecord(row.state_json);
    if (resolvedAgentId && row.entity_id === resolvedAgentId && row.state_namespace === 'core') {
      actorState = state;
      continue;
    }
    if (row.entity_id === DEFAULT_PACK_WORLD_ENTITY_ID && row.state_namespace === 'world') {
      worldState = state;
      continue;
    }
    if (row.state_namespace === 'artifact') {
      artifacts.push({
        id: row.entity_id,
        state
      });
    }
  }

  const actorRoles = Array.isArray(attributes.actor_roles)
    ? attributes.actor_roles.filter((entry): entry is string => typeof entry === 'string')
    : [];

  const latestEventRecord = await getLatestEventEvidenceRecord(context);

  const latestEvent = latestEventRecord
    ? {
        event_id: latestEventRecord.id,
        title: latestEventRecord.title,
        type: latestEventRecord.type,
        semantic_type:
          latestEventRecord.impact_data && latestEventRecord.impact_data.trim().length > 0
            ? (() => {
                try {
                  const parsed = JSON.parse(latestEventRecord.impact_data) as unknown;
                  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const semanticType = (parsed as Record<string, unknown>).semantic_type;
                    return typeof semanticType === 'string' ? semanticType : null;
                  }
                } catch {
                  return null;
                }
                return null;
              })()
            : null,
        created_at: latestEventRecord.created_at.toString()
      }
    : null;

  return {
    actor_roles: actorRoles,
    actor_state: actorState,
    owned_artifacts: artifacts,
    world_state: worldState,
    latest_event: latestEvent
  };
};

const buildPackRuntimeContract = (context: AppContext): InferencePackRuntimeContract => {
  const activePack = context.sim.getActivePack();
  if (!activePack) {
    return {};
  }

  return {
    invocation_rules: (activePack.rules?.invocation ?? []).map(rule => ({
      id: rule.id,
      when: { ...(rule.when ?? {}) },
      then: { ...(rule.then ?? {}) }
    }))
  };
};

const buildInferenceVariableContext = (input: {
  context: AppContext;
  pack: NonNullable<ReturnType<AppContext['sim']['getActivePack']>>;
  strategy: InferenceStrategy;
  attributes: Record<string, unknown>;
  resolvedActor: ResolvedActor;
  agentSnapshot: InferenceAgentSnapshot | null;
  packState: InferencePackStateSnapshot;
  packRuntime: InferencePackRuntimeContract;
  requestInput: InferenceRequestInput;
}): PromptVariableContext => {
  return createPromptVariableContext({
    layers: [
      createPromptVariableLayer({
        namespace: 'system',
        values: normalizePromptVariableRecord({ name: 'Yidhras', timezone: 'Asia/Shanghai' }),
        alias_values: normalizePromptVariableRecord({ system_name: 'Yidhras', timezone: 'Asia/Shanghai' }),
        metadata: { source_label: 'system-defaults', trusted: true }
      }),
      createPromptVariableLayer({
        namespace: 'app',
        values: normalizePromptVariableRecord({ startup_health: input.context.startupHealth }),
        alias_values: normalizePromptVariableRecord({ startup_level: input.context.startupHealth.level }),
        metadata: { source_label: 'app-context', trusted: true }
      }),
      createPromptVariableLayer({
        namespace: 'pack',
        values: normalizePromptVariableRecord({ metadata: input.pack.metadata, variables: input.pack.variables ?? {}, prompts: input.pack.prompts ?? {}, ai: input.pack.ai ?? null }),
        alias_values: normalizePromptVariableRecord({ ...(input.pack.variables ?? {}), world_name: input.pack.metadata.name, pack_id: input.pack.metadata.id, pack_name: input.pack.metadata.name }),
        metadata: { source_label: 'world-pack', trusted: true }
      }),
      createPromptVariableLayer({
        namespace: 'runtime',
        values: normalizePromptVariableRecord({ current_tick: input.context.sim.getCurrentTick().toString(), pack_state: input.packState, pack_runtime: input.packRuntime, world_state: input.packState.world_state, owned_artifacts: input.packState.owned_artifacts, latest_event: input.packState.latest_event }),
        alias_values: normalizePromptVariableRecord({ current_tick: input.context.sim.getCurrentTick().toString(), world_state: input.packState.world_state, latest_event: input.packState.latest_event, owned_artifacts: input.packState.owned_artifacts }),
        metadata: { source_label: 'runtime-state', trusted: true }
      }),
      createPromptVariableLayer({
        namespace: 'actor',
        values: normalizePromptVariableRecord({ identity_id: input.resolvedActor.identity.id, identity_type: input.resolvedActor.identity.type, display_name: input.resolvedActor.actorDisplayName, role: input.resolvedActor.actorRef.role, binding_ref: input.resolvedActor.bindingRef, agent_id: input.resolvedActor.resolvedAgentId, agent_snapshot: input.agentSnapshot }),
        alias_values: normalizePromptVariableRecord({ actor_name: input.resolvedActor.actorDisplayName, actor_role: input.resolvedActor.actorRef.role, actor_id: input.resolvedActor.resolvedAgentId ?? input.resolvedActor.identity.id, identity_id: input.resolvedActor.identity.id }),
        metadata: { source_label: 'resolved-actor', trusted: true }
      }),
      createPromptVariableLayer({
        namespace: 'request',
        values: normalizePromptVariableRecord({ task_type: 'agent_decision', strategy: input.strategy, attributes: input.attributes, agent_id: input.requestInput.agent_id ?? null, identity_id: input.requestInput.identity_id ?? null, idempotency_key: input.requestInput.idempotency_key ?? null }),
        alias_values: normalizePromptVariableRecord({ strategy: input.strategy, task_type: 'agent_decision', request_agent_id: input.requestInput.agent_id ?? null, request_identity_id: input.requestInput.identity_id ?? null }),
        metadata: { source_label: 'inference-request', mutable: true, trusted: true }
      })
    ]
  });
};

export const buildInferenceContext = async (
  context: AppContext,
  input: InferenceRequestInput
): Promise<InferenceContext> => {
  context.assertRuntimeReady('inference context');

  const activePackRuntime = getActivePackRuntimeFacade({
    activePackRuntime: context.activePackRuntime,
    sim: context.sim
  });
  const pack = activePackRuntime.getActivePack();
  if (!pack) {
    throw new ApiError(503, 'WORLD_PACK_NOT_READY', 'World pack not ready for inference context', {
      startup_level: context.startupHealth.level,
      available_world_packs: context.startupHealth.available_world_packs
    });
  }

  const strategy = selectStrategy(input);
  const attributes = normalizeAttributes(input.attributes);
  const resolvedActor = await resolveActor(context, input);

  let agentSnapshot: InferenceAgentSnapshot | null = null;

  if (resolvedActor.resolvedAgentId) {
    const agentContext = await getAgentContextSnapshot(context, resolvedActor.resolvedAgentId);
    agentSnapshot = buildAgentSnapshot(agentContext.identity as Record<string, unknown>);
  }

  const packState = await buildPackStateSnapshot(context, pack.metadata.id, resolvedActor.resolvedAgentId, attributes);
  const packRuntime = buildPackRuntimeContract(context);
  const policySummary = await buildPolicySummary(context, resolvedActor.identity, attributes);
  const transmissionProfile = buildTransmissionProfile(resolvedActor.actorRef, agentSnapshot, policySummary, attributes);
  const contextAssembly = context.contextAssembly ?? createContextAssemblyPort(context);
  const fallbackContextService = createContextService({
    context, memoryService: createMemoryService({ context })
  });
  const contextResult = await (contextAssembly.buildContextRun ?? fallbackContextService.buildContextRun)({
    actor_ref: resolvedActor.actorRef as unknown as Record<string, unknown>,
    identity: resolvedActor.identity,
    resolved_agent_id: resolvedActor.resolvedAgentId,
    tick: activePackRuntime.getCurrentTick(),
    policy_summary: policySummary,
    pack_state: packState,
    pack_id: pack.metadata.id
  });
  const variableContext = buildInferenceVariableContext({
    context, pack, strategy, attributes, resolvedActor, agentSnapshot, packState, packRuntime, requestInput: input
  });

  return {
    inference_id: randomUUID(),
    actor_ref: resolvedActor.actorRef,
    actor_display_name: resolvedActor.actorDisplayName,
    identity: resolvedActor.identity,
    binding_ref: resolvedActor.bindingRef,
    resolved_agent_id: resolvedActor.resolvedAgentId,
    agent_snapshot: agentSnapshot,
    tick: activePackRuntime.getCurrentTick(),
    strategy,
    attributes,
    world_pack: {
      id: pack.metadata.id,
      name: pack.metadata.name,
      version: pack.metadata.version
    },
    world_prompts: pack.prompts ?? {},
    world_ai: pack.ai ?? null,
    visible_variables: flattenPromptVariableContextToVisibleVariables(variableContext) as VariablePool,
    variable_context: variableContext,
    policy_summary: policySummary,
    transmission_profile: transmissionProfile,
    context_run: contextResult.context_run,
    memory_context: contextResult.memory_context,
    pack_state: packState,
    pack_runtime: packRuntime,
    variable_context_summary: createPromptVariableContextSummary(variableContext)
  };
};
