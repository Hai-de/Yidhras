import { randomUUID } from 'node:crypto';

import type { DataContext, PortContext, RuntimeContext } from '../../app/context.js';
import { resolvePackTick } from '../../app/services/pack/pack_runtime_resolution.js';
import type { WorldPack } from '../../packs/manifest/constitution_loader.js';
import { packEntityIdFromResolvedAgentId } from '../../packs/utils/pack_entity_id.js';
import {
  createPromptVariableContextSummary,
  flattenPromptVariableContextToVisibleVariables
} from '../../template_engine/frontends/narrative/variable_context.js';
import { ApiError } from '../../utils/api_error.js';
import { isRecord } from '../../utils/type_guards.js';
import type { InferenceContext, InferenceRequestInput, InferenceStrategy } from '../types.js';
import { resolveActor } from './actor_resolver.js';
import { resolveAuthority } from './authority_adapter.js';
import { InferenceContextConfigLoader } from './config_loader.js';
import { buildPolicySummary } from './policy_summary_builder.js';
import { buildPackStateSnapshot } from './state_snapshot_builder.js';
import { buildTransmissionProfile } from './transmission_profile.js';
import type {
  ContextRunInput,
  PipelineOptions,
  ResolvedActor} from './types.js';
import { assembleVariableContext } from './variable_context_assembler.js';

type Ctx = DataContext & RuntimeContext & PortContext;

const SUPPORTED_STRATEGIES: InferenceStrategy[] = ['mock', 'model_routed', 'behavior_tree'];

export class ContextAssemblyPipeline {
  constructor(private readonly options: PipelineOptions = {}) {}

  async execute(
    context: Ctx,
    input: InferenceRequestInput & { pack_id: string; mode?: 'stable' | 'experimental' }
  ): Promise<InferenceContext> {
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
    const strategy = this.selectStrategy(input);
    const attributes = this.normalizeAttributes(input.attributes);

    const actor = await this.wrapStage('actor_resolution', () =>
      resolveActor(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- EOPT strict mode boundary cast
        { repos: context.repos as never, getPackRuntimeHost: (packId: string) => context.getPackRuntimeHost?.(packId) ?? null },
        input,
        input.pack_id
      )
    );

    const { effectiveStrategy, effectiveAttributes } = this.applyActorOverride(
      pack, actor, strategy, attributes, input.pack_id
    );

    const packState = await buildPackStateSnapshot(
      { prisma: context.prisma },
      context.packStorageAdapter,
      { packId: input.pack_id, resolvedAgentId: actor.resolved_agent_id, attributes: effectiveAttributes }
    );

    const { capabilities: agentCapabilities } = await resolveAuthority(
      context, input.pack_id, actor.resolved_agent_id
    );

    const config = new InferenceContextConfigLoader(this.options.deploymentId).getConfig();

    const policySummary = await buildPolicySummary(
      { repos: { identityOperator: context.repos.identityOperator } },
      { identity: actor.identity, attributes: effectiveAttributes },
      config
    );

    const transmissionProfile = buildTransmissionProfile(
      {
        actorRef: actor.actor_ref,
        agentSnapshot: actor.agent_snapshot,
        policySummary,
        attributes: effectiveAttributes
      },
      config
    );

    // Build pack runtime contract (invocation rules from pack definition)
    const packRuntime = this.buildPackRuntimeContract(pack);

// @ts-expect-error -- EOPT strict mode
    const contextRunResult = await this.buildContextRun(context, {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type coercion for context run
      actor_ref: actor.actor_ref as unknown as Record<string, unknown>,
      identity: actor.identity,
      resolved_agent_id: actor.resolved_agent_id,
      tick: BigInt(currentTick),
      policy_summary: policySummary,
      pack_state: packState,
      pack_id: input.pack_id,
      agent_capabilities: agentCapabilities,
      perception_rules: pack.rules?.perception
    });

    const variableContext = assembleVariableContext(
      {
        pack: {
          metadata: pack.metadata,
          variables: pack.variables,
          prompts: pack.prompts,
          ai: pack.ai ?? null
        },
        strategy: effectiveStrategy,
        attributes: effectiveAttributes,
        actor,
        packState,
        packRuntime: {},
        requestInput: input,
        currentTick
      },
      config
    );

    return {
      inference_id: randomUUID(),
      actor_ref: actor.actor_ref,
      actor_display_name: actor.actor_display_name,
      identity: actor.identity,
      binding_ref: actor.binding_ref,
      resolved_agent_id: actor.resolved_agent_id,
      agent_snapshot: actor.agent_snapshot,
      tick: BigInt(currentTick),
      strategy: effectiveStrategy,
      attributes: effectiveAttributes,
      world_pack: {
        instance_id: input.pack_id,
        metadata_id: pack.metadata.id,
        name: pack.metadata.name,
        version: pack.metadata.version,
        ...(isRecord(pack.behavior_trees) ? { behavior_trees: pack.behavior_trees } : {})
      },
      world_prompts: (pack.prompts ?? {}),
      world_ai: pack.ai ?? null,
      visible_variables: flattenPromptVariableContextToVisibleVariables(variableContext),
      variable_context: variableContext,
      variable_context_summary: createPromptVariableContextSummary(variableContext),
      policy_summary: policySummary,
      transmission_profile: transmissionProfile,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ContextServiceBuildResult boundary
      context_run: contextRunResult.context_run as unknown as InferenceContext['context_run'],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ContextServiceBuildResult boundary
      memory_context: contextRunResult.memory_context as unknown as InferenceContext['memory_context'],
      pack_state: packState,
      pack_runtime: packRuntime,
      agent_capabilities: agentCapabilities,
      notifications: context.notifications,
      previous_agent_output: input.previous_agent_output
       
    };
  }

  private selectStrategy(input: InferenceRequestInput): InferenceStrategy {
    if (!input.strategy) return 'mock';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated below against SUPPORTED_STRATEGIES
    if (!SUPPORTED_STRATEGIES.includes(input.strategy as InferenceStrategy)) {
      throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'strategy is not supported', {
        allowed_strategies: SUPPORTED_STRATEGIES,
        strategy: input.strategy
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated above against SUPPORTED_STRATEGIES
    return input.strategy as InferenceStrategy;
  }

  private normalizeAttributes(value: unknown): Record<string, unknown> {
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ApiError(400, 'INFERENCE_INPUT_INVALID', 'attributes must be an object');
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated as object above
    return value as Record<string, unknown>;
  }

  private applyActorOverride(
    pack: WorldPack,
    actor: ResolvedActor,
    strategy: InferenceStrategy,
    attributes: Record<string, unknown>,
    packId: string
  ): { effectiveStrategy: InferenceStrategy; effectiveAttributes: Record<string, unknown> } {
    if (!actor.actor_ref.agent_id) {
      return { effectiveStrategy: strategy, effectiveAttributes: attributes };
    }

    const entityId = packEntityIdFromResolvedAgentId(packId, actor.actor_ref.agent_id);
    const actorDef = entityId
      ? pack.entities?.actors?.find((a) => a.id === entityId)
      : undefined;
    const inf = actorDef?.inference as Record<string, unknown> | undefined;

    if (inf?.['provider'] === 'behavior_tree') {
      return {
        effectiveStrategy: 'behavior_tree',
        effectiveAttributes: { ...attributes, behavior_tree: inf['behavior_tree'] }
      };
    }
    if (inf?.['provider'] === 'openai_compatible' || inf?.['provider'] === 'anthropic') {
      return {
        effectiveStrategy: 'model_routed',
        effectiveAttributes: { ...attributes, actor_model: inf['model'], actor_provider: inf['provider'] }
      };
    }

    return { effectiveStrategy: strategy, effectiveAttributes: attributes };
  }

  private buildPackRuntimeContract(pack: WorldPack): InferenceContext['pack_runtime'] {
    const invocationRules = (pack.rules?.invocation ?? []).map((rule) => ({
      id: rule.id,
      when: { ...(rule.when ?? {}) },
      then: { ...(rule.then ?? {}) }
    }));
    return { invocation_rules: invocationRules.length > 0 ? invocationRules : undefined };
  }

  private async buildContextRun(
    context: Ctx,
    input: ContextRunInput
  ): Promise<{ context_run: Record<string, unknown>; memory_context: Record<string, unknown> }> {
     
    const contextAssembly = context.contextAssembly;
    if (!contextAssembly) {
      throw new ApiError(500, 'CONTEXT_ASSEMBLY_MISSING', 'Context assembly port is not configured');
    }

    if (!contextAssembly.buildContextRun) {
      throw new ApiError(500, 'CONTEXT_ASSEMBLY_MISSING', 'Context assembly port is not configured with buildContextRun');
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- BuildContextRunInput boundary
    const result = await contextAssembly.buildContextRun(input as never);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ContextServiceBuildResult boundary
    return result as never;
  }

  private async wrapStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Error && err.name === 'ContextAssemblyError') throw err;
      const wrapped = new Error(`[${stage}] ${err instanceof Error ? err.message : String(err)}`);
      wrapped.name = 'ContextAssemblyError';
      throw wrapped;
    }
  }
}
