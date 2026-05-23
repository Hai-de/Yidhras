import { randomUUID } from 'node:crypto';

import { AccessPolicyService } from '../access_policy/service.js';
import type { AppInfrastructure } from '../app/context.js';
import { getAgentContextSnapshot } from '../app/services/agent/agent.js';
import type { AppContextPorts } from '../app/services/app_context_ports.js';
import { createContextAssemblyPort } from '../app/services/context/context_memory_ports.js';
import { getLatestEventEvidenceRecord } from '../app/services/mutation/event_evidence_repository.js';
import { resolvePackTick } from '../app/services/pack/pack_runtime_resolution.js';
import { buildPreviousAgentOutputTemplateScope } from '../app/services/workflow/workflow_previous_output.js';
import { resolveAuthorityForSubject } from '../domain/authority/resolver.js';
import type { IdentityContext } from '../identity/types.js';
import { DEFAULT_PACK_WORLD_ENTITY_ID } from '../packs/runtime/core_models.js';
import { listPackEntityStateProjectionRecords } from '../packs/storage/entity_state_projection.js';
import type { PromptVariableContext, PromptVariableNamespace } from '../template_engine/frontends/narrative/types.js';
import {
  createPromptVariableContext,
  createPromptVariableContextSummary,
  createPromptVariableLayer,
  flattenPromptVariableContextToVisibleVariables,
  normalizePromptVariableRecord
} from '../template_engine/frontends/narrative/variable_context.js';
import { ApiError } from '../utils/api_error.js';
import { getInferenceContextConfig } from './context_config.js';
import { resolveConfigValues } from './context_config_resolver.js';
import type { InferenceContextConfig } from './context_config_schema.js';
import type {
  BuildInferenceContextForPackInput,
  PackRuntimeContractResolver,
  PackScopedInferenceContextBuilder
} from './pack_scoped_inference_context_builder.js';
import type {
  InferenceActorRef,
  InferenceAgentSnapshot,
  InferenceBindingRef,
  InferenceContext,
  InferencePackArtifactSnapshot,
  InferencePackLatestEventSnapshot,
  InferencePackRuntimeContract,
  InferencePackStateRecord,
  InferencePackStateSnapshot,
  InferencePolicySummary,
  InferenceRequestInput,
  InferenceStrategy,
  InferenceTransmissionProfile
} from './types.js';

type Ctx = AppInfrastructure & Pick<AppContextPorts, 'packRuntimeLookup' | 'contextAssembly'> & {
  getPackRuntimeHost?(packId: string): { getPack(): import('../packs/manifest/loader.js').WorldPack | undefined } | null;
};

const SUPPORTED_STRATEGIES: InferenceStrategy[] = ['mock', 'model_routed', 'behavior_tree'];

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
  actor_ref: InferenceActorRef;
  actor_display_name: string;
  identity: IdentityContext;
  binding_ref: InferenceBindingRef | null;
  resolved_agent_id: string | null;
  agent_snapshot: InferenceAgentSnapshot | null;
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

const createAccessPolicyService = (context: Ctx): AccessPolicyService => {
  return new AccessPolicyService(context.repos.identityOperator);
};

// eslint-disable-next-line @typescript-eslint/require-await
const listActiveBindingsForIdentity = async (context: Ctx, identityId: string): Promise<BindingRecord[]> => {
  return context.repos.identityOperator.listIdentityBindings({
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
  }) as unknown as BindingRecord[];
};

const resolveIdentityById = async (context: Ctx, identityId: string): Promise<IdentityContext | null> => {
  return context.repos.identityOperator.findIdentityById(identityId);
};

export const ACTOR_ENTITY_ID_SEPARATOR = ':';

export const packEntityIdFromResolvedAgentId = (packId: string, resolvedAgentId: string | null): string | null => {
  if (!resolvedAgentId) return null;
  const prefix = `${packId}${ACTOR_ENTITY_ID_SEPARATOR}`;
  if (resolvedAgentId.startsWith(prefix)) {
    return resolvedAgentId.slice(prefix.length);
  }
  return resolvedAgentId;
};

const resolveActor = async (context: Ctx, input: InferenceRequestInput, packId?: string): Promise<ResolvedActor> => {
  if (input.agent_id) {
    const agentContext = await getAgentContextSnapshot(context, input.agent_id, packId);
    return {
      identity: agentContext.identity as IdentityContext,
      actor_ref: {
        identity_id: agentContext.identity.id,
        identity_type: agentContext.identity.type as IdentityContext['type'],
        role: 'active',
        agent_id: input.agent_id,
        atmosphere_node_id: null
      },
      actor_display_name: agentContext.identity.name ?? input.agent_id,
      binding_ref: null,
      resolved_agent_id: input.agent_id,
      agent_snapshot: buildAgentSnapshot(agentContext.identity)
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
      const boundAgentContext = await getAgentContextSnapshot(context, binding.agent_id, packId);
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
        binding_ref: toBindingRef(binding),
        resolved_agent_id: binding.agent_id,
        agent_snapshot: buildAgentSnapshot(boundAgentContext.identity)
      };
    }

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
        binding_ref: toBindingRef(binding),
        resolved_agent_id: null,
        agent_snapshot: null
      };
    }

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

  if (input.actor_entity_id && packId) {
    const bridgedAgentId = `${packId}${ACTOR_ENTITY_ID_SEPARATOR}${input.actor_entity_id}`;
    const agent = await context.repos.agent.findAgentById(bridgedAgentId);
    if (!agent) {
      throw new ApiError(404, 'ACTOR_ENTITY_NOT_FOUND', 'Pack actor entity not found', {
        actor_entity_id: input.actor_entity_id,
        pack_id: packId
      });
    }

    const pack = context.getPackRuntimeHost?.(packId)?.getPack();
    const actorDef = pack?.entities?.actors?.find(a => a.id === input.actor_entity_id);
    const entityKind = actorDef?.kind ?? 'actor';

    const binding = await context.repos.identityOperator.findActiveBindingForAgent(bridgedAgentId);

    const identityContext: IdentityContext = binding
      ? {
          id: binding.identity?.id ?? '',
          type: (binding.identity?.type as IdentityContext['type']) ?? 'noise',
          name: binding.identity?.name ?? '',
          provider: binding.identity?.provider ?? undefined,
          status: binding.identity?.status ?? undefined,
          claims: binding.identity?.claims as Record<string, unknown> | null ?? null
        }
      : {
          id: `${packId}:identity:${input.actor_entity_id}`,
          type: 'agent',
          name: agent.name,
          provider: 'pack',
          status: 'active',
          claims: null
        };

    return {
      identity: identityContext,
      actor_ref: {
        identity_id: identityContext.id,
        identity_type: identityContext.type,
        entity_kind: entityKind,
        role: 'active',
        agent_id: bridgedAgentId,
        atmosphere_node_id: null
      },
      actor_display_name: agent.name ?? input.actor_entity_id,
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

  const systemIdentity = await resolveIdentityById(context, 'system');
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
  context: Ctx,
  identity: IdentityContext,
  attributes: Record<string, unknown>,
  config?: InferenceContextConfig
): Promise<InferencePolicySummary> => {
  const service = createAccessPolicyService(context);
  const resolvedConfig = config ?? getInferenceContextConfig();
  const evaluations = resolvedConfig.policy_summary?.evaluations ?? [
    {
      resource: 'social_post',
      action: 'read',
      fields: ['id', 'author_id', 'content', 'created_at', 'content.private.preview', 'content.private.raw']
    },
    {
      resource: 'social_post',
      action: 'write',
      fields: ['content']
    }
  ];

  const results: Record<string, { allowed: boolean; fields: string[] }> = {};

  for (const evaluation of evaluations) {
    const result = await service.evaluateFields(
      {
        identity,
        resource: evaluation.resource,
        action: evaluation.action,
        attributes
      },
      evaluation.fields
    );
    const key = `${evaluation.resource}_${evaluation.action}`;
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
    results[key] = {
      allowed: result.allowedFields.size > 0,
      fields: Array.from(result.allowedFields)
    };
  }

  const read = results['social_post_read'];
  const write = results['social_post_write'];

  return {
    social_post_read_allowed: read?.allowed ?? false,
    social_post_readable_fields: read?.fields ?? [],
    social_post_write_allowed: write?.allowed ?? false,
    social_post_writable_fields: write?.fields ?? []
  };
};

const buildTransmissionProfile = (
  actorRef: InferenceActorRef,
  agentSnapshot: InferenceAgentSnapshot | null,
  policySummary: InferencePolicySummary,
  attributes: Record<string, unknown>,
  config?: InferenceContextConfig
): InferenceTransmissionProfile => {
  const tpConfig = (config ?? getInferenceContextConfig()).transmission_profile;
  const snrFallback = tpConfig?.defaults?.snr_fallback ?? 0.5;
  const fragileSnr = tpConfig?.thresholds?.fragile_snr ?? 0.3;
  const fragileDrop = tpConfig?.drop_chances?.fragile ?? 0.35;
  const bestEffortDrop = tpConfig?.drop_chances?.best_effort ?? 0.15;
  const reliableDrop = tpConfig?.drop_chances?.reliable ?? 0.0;
  const readRestrictedBase = tpConfig?.policies?.read_restricted_base ?? 'best_effort';
  const lowSnrBase = tpConfig?.policies?.low_snr_base ?? 'fragile';
  const defaultBase = tpConfig?.policies?.default_base ?? 'reliable';

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

  const actorSNR = agentSnapshot?.snr ?? snrFallback;
  const readRestricted = !policySummary.social_post_read_allowed;
  const resolvedBasePolicy = readRestricted
    ? readRestrictedBase
    : actorSNR < fragileSnr
      ? lowSnrBase
      : defaultBase;
  const resolvedPolicy: InferenceTransmissionProfile['policy'] =
    explicitPolicy === 'reliable' || explicitPolicy === 'best_effort' || explicitPolicy === 'fragile'
      ? explicitPolicy
      : resolvedBasePolicy;

  const dropChance =
    explicitDropChance ??
    (resolvedPolicy === 'fragile' ? fragileDrop : resolvedPolicy === 'best_effort' ? bestEffortDrop : reliableDrop);

  return {
    policy: resolvedPolicy,
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

const fetchRecentEvents = async (
  context: Ctx,
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
      semantic_type: (() => {
        if (!row.impact_data || row.impact_data.trim().length === 0) return null;
        try {
          const parsed = JSON.parse(row.impact_data) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const st = (parsed as Record<string, unknown>).semantic_type;
            return typeof st === 'string' ? st : null;
          }
        } catch {
          return null;
        }
        return null;
      })(),
      tick: row.tick.toString(),
      created_at: row.created_at.toString()
    }));
  } catch {
    return [];
  }
};

const buildPackStateSnapshot = async (
  context: Ctx,
  packId: string,
  resolvedAgentId: string | null,
  attributes: Record<string, unknown>
): Promise<InferencePackStateSnapshot> => {
  const rows = await listPackEntityStateProjectionRecords(context.packStorageAdapter, packId);

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
    const state = parsePackStateRecord(row.state_json);
    if (candidateEntityIds.length > 0 && candidateEntityIds.includes(row.entity_id) && row.state_namespace === 'core') {
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

const buildPackRuntimeContract = (context: Ctx, packId: string): InferencePackRuntimeContract => {
  const pack = context.getPackRuntimeHost?.(packId)?.getPack();
  if (!pack) {
    return {};
  }

  return {
    invocation_rules: (pack.rules?.invocation ?? []).map(rule => ({
      id: rule.id,
      when: { ...(rule.when ?? {}) },
      then: { ...(rule.then ?? {}) }
    }))
  };
};

const createPackRuntimeContractResolver = (): PackRuntimeContractResolver => {
  return {
    resolvePackRuntimeContract(
      context: Ctx,
      input: {
        pack_id: string;
        mode: 'stable' | 'experimental';
      }
    ): Promise<InferencePackRuntimeContract> {
      if (input.mode === 'stable') {
        return Promise.resolve(buildPackRuntimeContract(context, input.pack_id));
      }

      const summary = context.packRuntimeLookup?.getPackRuntimeSummary(input.pack_id);
      if (!summary) {
        return Promise.resolve({});
      }

      // Additional packs (experimental scope) do not expose invocation rules
      // through PackRuntimeLookupPort; they rely on the default empty contract.
      return Promise.resolve({});
    }
  };
};

const buildInferenceVariableContext = (input: {
  context: Ctx;
  pack: { metadata: { id: string; name: string; version: string }; variables?: Record<string, unknown>; prompts?: Record<string, unknown>; ai?: unknown; };
  strategy: InferenceStrategy;
  attributes: Record<string, unknown>;
  resolvedActor: ResolvedActor;
  packState: InferencePackStateSnapshot;
  packRuntime: InferencePackRuntimeContract;
  requestInput: InferenceRequestInput;
  currentTick: string;
  config?: InferenceContextConfig;
}): PromptVariableContext => {
  const resolvedConfig = (input.config ?? getInferenceContextConfig()).variable_context;
  const runtimeObjects: Record<string, unknown> = {
    app: { startup_health: input.context.startupHealth },
    pack: {
      metadata: input.pack.metadata,
      variables: input.pack.variables ?? {},
      prompts: input.pack.prompts ?? {},
      ai: input.pack.ai ?? null
    },
    runtime: {
      current_tick: input.currentTick,
      pack_state: input.packState,
      pack_runtime: input.packRuntime
    },
    actor: {
      identity: input.resolvedActor.identity,
      display_name: input.resolvedActor.actor_display_name,
      role: input.resolvedActor.actor_ref.role,
      binding_ref: input.resolvedActor.binding_ref,
      agent_id: input.resolvedActor.resolved_agent_id,
      agent_snapshot: input.resolvedActor.agent_snapshot
    },
    previous_agent_output: buildPreviousAgentOutputTemplateScope(input.requestInput.previous_agent_output),
    request: {
      strategy: input.strategy,
      attributes: input.attributes,
      agent_id: input.requestInput.agent_id ?? null,
      identity_id: input.requestInput.identity_id ?? null,
      idempotency_key: input.requestInput.idempotency_key ?? null
    }
  };

  const configuredLayers = resolvedConfig?.layers;
  const layerOrder = ['system', 'app', 'pack', 'runtime', 'actor', 'request'];

  const layers = layerOrder
    .map((namespace) => {
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
      const layerConfig = configuredLayers?.[namespace];
      if (!layerConfig) return null;
      if (layerConfig.enabled === false) return null;

      const values = resolveConfigValues(layerConfig.values, runtimeObjects);
      const aliasValues = layerConfig.alias_values
        ? resolveConfigValues(layerConfig.alias_values, runtimeObjects)
        : {};

      const isMutable = namespace === 'request';
      const isRequest = namespace === 'request';

      return createPromptVariableLayer({
        namespace: namespace as PromptVariableNamespace,
        values: normalizePromptVariableRecord(values),
        alias_values: normalizePromptVariableRecord(aliasValues),
        metadata: {
          source_label: isRequest ? 'inference-request' : `${namespace}-config`,
          ...(isMutable ? { mutable: true } : {}),
          trusted: true
        }
      });
    })
    .filter((layer): layer is NonNullable<typeof layer> => layer !== null);

  const previousAgentOutputValues = runtimeObjects.previous_agent_output as Record<string, unknown>;
  if (Object.keys(previousAgentOutputValues).length > 0) {
    layers.push(createPromptVariableLayer({
      namespace: 'previous_agent_output',
      values: normalizePromptVariableRecord(previousAgentOutputValues),
      alias_values: {
        previous_agent_output: normalizePromptVariableRecord(previousAgentOutputValues)
      },
      metadata: {
        source_label: 'workflow-previous-agent-output',
        trusted: true
      }
    }));
  }

  if (layers.length === 0) {
    // No configured layers — variable resolution will be limited.
    // YAML config (data/configw/default.yaml) should provide layer definitions.
    return createPromptVariableContext({ layers: [] });
  }

  return createPromptVariableContext({ layers });
};

export const createPackScopedInferenceContextBuilder = (): PackScopedInferenceContextBuilder => {
  const packRuntimeContractResolver = createPackRuntimeContractResolver();

  return {
    async buildForPack(context: Ctx, input: BuildInferenceContextForPackInput): Promise<InferenceContext> {
      context.assertRuntimeReady('inference context');

      const pack = context.getPackRuntimeHost?.(input.pack_id)?.getPack();
      if (!pack) {
        throw new ApiError(503, 'WORLD_PACK_NOT_READY', 'World pack not ready for inference context', {
          pack_id: input.pack_id,
          startup_level: context.startupHealth.level,
          available_world_packs: context.startupHealth.available_world_packs
        });
      }

      const currentTick = resolvePackTick(context).toString();

      let strategy = selectStrategy(input);
      const attributes = normalizeAttributes(input.attributes);
      const resolvedActor = await resolveActor(context, input, input.pack_id);

      // Actor-level inference config override
      if (resolvedActor.actor_ref.agent_id) {
        const entityId = packEntityIdFromResolvedAgentId(input.pack_id, resolvedActor.actor_ref.agent_id);
        const actorDef = entityId
          ? pack.entities?.actors?.find((a) => a.id === entityId)
          : undefined;
        const inf = actorDef?.inference as Record<string, unknown> | undefined;
        if (inf?.provider === 'behavior_tree') {
          strategy = 'behavior_tree';
          attributes.behavior_tree = inf.behavior_tree;
        } else if (inf?.provider === 'openai_compatible' || inf?.provider === 'anthropic') {
          strategy = 'model_routed';
          // Actor-level LLM config: model detail stored for provider resolution
          attributes.actor_model = inf.model;
          attributes.actor_provider = inf.provider;
        }
      }

      const deploymentId = process.env.YIDHRAS_DEPLOYMENT_ID?.trim() || undefined;
      const config = getInferenceContextConfig(deploymentId);

      const packState = await buildPackStateSnapshot(context, input.pack_id, resolvedActor.resolved_agent_id, attributes);
      const authorityResult = await resolveAuthorityForSubject(context, {
        packId: input.pack_id,
        subjectEntityId: packEntityIdFromResolvedAgentId(
          input.pack_id,
          resolvedActor.resolved_agent_id
        )
      });
      const agentCapabilities = authorityResult.resolved_capabilities.map(c => c.capability_key);
      const packRuntime = await packRuntimeContractResolver.resolvePackRuntimeContract(context, {
        pack_id: input.pack_id,
        mode: input.mode
      });
      const policySummary = await buildPolicySummary(
        context,
        resolvedActor.identity,
        attributes,
        config
      );
      const transmissionProfile = buildTransmissionProfile(
        resolvedActor.actor_ref,
        resolvedActor.agent_snapshot,
        policySummary,
        attributes,
        config
      );
      const contextAssembly = context.contextAssembly ?? createContextAssemblyPort(context as unknown as import('../app/context.js').AppContext);
      if (!contextAssembly.buildContextRun) {
        throw new ApiError(500, 'CONTEXT_ASSEMBLY_MISSING', 'Context assembly port is not configured with buildContextRun');
      }
      const contextResult = await contextAssembly.buildContextRun({
        actor_ref: resolvedActor.actor_ref as unknown as Record<string, unknown>,
        identity: resolvedActor.identity,
        resolved_agent_id: resolvedActor.resolved_agent_id,
        tick: BigInt(currentTick),
        policy_summary: policySummary,
        pack_state: packState,
        pack_id: input.pack_id,
        agent_capabilities: agentCapabilities,
        perception_rules: pack.rules?.perception ?? []
      });
      const variableContext = buildInferenceVariableContext({
        context,
        pack,
        strategy,
        attributes,
        resolvedActor,
        packState,
        packRuntime,
        requestInput: input,
        currentTick,
        config
      });
      const rawBehaviorTrees = (pack as unknown as { behavior_trees?: unknown }).behavior_trees;

      return {
        inference_id: randomUUID(),
        actor_ref: resolvedActor.actor_ref,
        actor_display_name: resolvedActor.actor_display_name,
        identity: resolvedActor.identity,
        binding_ref: resolvedActor.binding_ref,
        resolved_agent_id: resolvedActor.resolved_agent_id,
        agent_snapshot: resolvedActor.agent_snapshot,
        tick: BigInt(currentTick),
        strategy,
        attributes,
        world_pack: {
          instance_id: input.pack_id,
          metadata_id: pack.metadata.id,
          name: pack.metadata.name,
          version: pack.metadata.version,
          ...(isRecord(rawBehaviorTrees) ? { behavior_trees: rawBehaviorTrees } : {})
        },
        world_prompts: pack.prompts ?? {},
        world_ai: pack.ai ?? null,
        visible_variables: flattenPromptVariableContextToVisibleVariables(variableContext),
        variable_context: variableContext,
        policy_summary: policySummary,
        transmission_profile: transmissionProfile,
        context_run: contextResult.context_run,
        memory_context: contextResult.memory_context,
        pack_state: packState,
        pack_runtime: packRuntime,
        agent_capabilities: agentCapabilities,
        variable_context_summary: createPromptVariableContextSummary(variableContext),
        previous_agent_output: input.previous_agent_output
      };
    }
  };
};

export const buildInferenceContext = async (
  context: Ctx,
  input: InferenceRequestInput,
  packId: string
): Promise<InferenceContext> => {
  return createPackScopedInferenceContextBuilder().buildForPack(context, {
    ...input,
    pack_id: packId,
    mode: 'stable'
  });
};
