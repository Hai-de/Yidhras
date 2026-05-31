import type { PluginManifest } from '@yidhras/contracts';

import type { AppContext } from '../app/context.js';
import type {
  QueryContributor,
  RuleContributor,
  StepContributor
} from '../app/runtime/world_engine_contributors.js';
import type { ContextSourceAdapter } from '../context/source_registry.js';
import type { PromptWorkflowStepExecutor } from '../context/workflow/registry.js';
import {
  setPluginsActive,
  setPluginWorkersActive} from '../observability/metrics.js';
import type { PerceptionResolver } from '../perception/types.js';
import { captureError } from '../utils/capture_error.js';
import { createLogger } from '../utils/logger.js';
import type { PluginInferenceRequest, PluginInferenceResult } from './types.js';
import {
  PLUGIN_HOST_API_VERSION,
  type PluginCapabilityKey
} from './capability_keys.js';
import { resolveLoadOrder } from './dependency_resolver.js';
import { dataCleanerRegistry } from './extensions/data_cleaner_registry.js';
import { slotConditionRegistry } from './extensions/slot_condition_registry.js';
import { slotContentTransformRegistry } from './extensions/slot_content_transformer.js';
import type {
  ContextSourceDescriptorInput,
  ContributionDescriptor,
  DataCleanerDescriptorInput,
  PackRouteDescriptorInput,
  PerceptionResolverDescriptorInput,
  PromptWorkflowStepDescriptorInput,
  QueryContributorDescriptorInput,
  RuleContributorDescriptorInput,
  SlotConditionEvaluatorDescriptorInput,
  SlotContentTransformerDescriptorInput,
  StepContributorDescriptorInput} from './worker/contribution_descriptors.js';
import { createWorkerContributionProxies, type WorkerPackRouteProxy } from './worker/contribution_proxy.js';
import type { PluginWorkerClient } from './worker/PluginWorkerClient.js';
import { pluginWorkerManager, resolvePluginEntrypointPath } from './worker/PluginWorkerManager.js';

const runtimeLogger = createLogger('plugin-sandbox-runtime');

type Ctx = AppContext;

export type { PluginInferenceRequest, PluginInferenceResult };

export interface ServerPluginHostApi {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime handler registration
  registerHandler(name: string, handler: (input: any) => unknown): void;
  registerContextSource(descriptor: ContextSourceDescriptorInput, capabilityKey?: PluginCapabilityKey): void;
  registerPromptWorkflowStep(descriptor: PromptWorkflowStepDescriptorInput, capabilityKey?: PluginCapabilityKey): void;
  registerPackRoute(descriptor: PackRouteDescriptorInput, capabilityKey?: PluginCapabilityKey): void;
  registerStepContributor(descriptor: StepContributorDescriptorInput, capabilityKey?: PluginCapabilityKey): void;
  registerRuleContributor(descriptor: RuleContributorDescriptorInput, capabilityKey?: PluginCapabilityKey): void;
  registerQueryContributor(descriptor: QueryContributorDescriptorInput, capabilityKey?: PluginCapabilityKey): void;
  registerDataCleaner(descriptor: DataCleanerDescriptorInput, capabilityKey?: PluginCapabilityKey): void;
  registerSlotConditionEvaluator(descriptor: SlotConditionEvaluatorDescriptorInput, capabilityKey?: PluginCapabilityKey): void;
  registerSlotContentTransformer(descriptor: SlotContentTransformerDescriptorInput, capabilityKey?: PluginCapabilityKey): void;
  registerPerceptionResolver(descriptor: PerceptionResolverDescriptorInput, capabilityKey?: PluginCapabilityKey): void;
  requestInference(input: PluginInferenceRequest): Promise<PluginInferenceResult>;
  upsertPackCollectionRecord(collectionKey: string, record: Record<string, unknown>): Promise<void>;
  listPackCollectionRecords(collectionKey: string): Promise<Record<string, unknown>[]>;
  emitEvent(event: { title: string; description: string; type: string; impact_data?: Record<string, unknown>; location_id?: string; visibility?: string }): Promise<void>;
  registerLoopHook(hookPoint: string, handler: (ctx: Record<string, unknown>) => Promise<void>): void;
}

export interface RegisteredServerPluginRuntime {
  installation_id: string;
  plugin_id: string;
  pack_id: string;
  manifest: PluginManifest;
  granted_capabilities: string[];
  context_sources: ContextSourceAdapter[];
  prompt_workflow_steps: PromptWorkflowStepExecutor[];
  pack_routes: WorkerPackRouteProxy[];
  step_contributors: StepContributor[];
  rule_contributors: RuleContributor[];
  query_contributors: QueryContributor[];
  perception_resolvers: PerceptionResolver[];
  contribution_descriptors: ContributionDescriptor[];
  handler_names: string[];
  loop_hook_points: string[];
  worker_client?: PluginWorkerClient;
  inferenceExecutor?: (input: PluginInferenceRequest) => Promise<PluginInferenceResult>;
  deactivate?: () => void | Promise<void>;
}

class PluginRuntimeRegistry {
  private runtimes = new Map<string, RegisteredServerPluginRuntime[]>();

  public replaceRuntimes(packId: string, runtimes: RegisteredServerPluginRuntime[]): RegisteredServerPluginRuntime[] {
    const previous = this.runtimes.get(packId) ?? [];
    this.runtimes.set(packId, runtimes);
    return previous;
  }

  public clearRuntimes(packId: string): RegisteredServerPluginRuntime[] {
    return this.replaceRuntimes(packId, []);
  }

  public listRuntimes(packId: string): RegisteredServerPluginRuntime[] {
    return this.runtimes.get(packId) ?? [];
  }

  public getRuntime(packId: string, installationId: string): RegisteredServerPluginRuntime | undefined {
    return this.listRuntimes(packId).find(runtime => runtime.installation_id === installationId);
  }

  public getContextSourceAdapters(packId: string): ContextSourceAdapter[] {
    return this.listRuntimes(packId).flatMap(runtime => runtime.context_sources);
  }

  public getPromptWorkflowStepExecutors(packId: string): PromptWorkflowStepExecutor[] {
    return this.listRuntimes(packId).flatMap(runtime => runtime.prompt_workflow_steps);
  }

  public getStepContributors(packId: string): StepContributor[] {
    return this.listRuntimes(packId)
      .flatMap(runtime => runtime.step_contributors)
      .sort((a, b) => a.priority - b.priority);
  }

  public getRuleContributors(packId: string): RuleContributor[] {
    return this.listRuntimes(packId).flatMap(runtime => runtime.rule_contributors);
  }

  public getQueryContributors(packId: string): QueryContributor[] {
    return this.listRuntimes(packId).flatMap(runtime => runtime.query_contributors);
  }

  public getPerceptionResolvers(packId: string): PerceptionResolver[] {
    return this.listRuntimes(packId).flatMap(runtime => runtime.perception_resolvers);
  }

  public getLoopHooks(packId: string): Array<{ hookPoint: string; runtime: RegisteredServerPluginRuntime }> {
    return this.listRuntimes(packId).flatMap(runtime =>
      runtime.loop_hook_points.map(hookPoint => ({ hookPoint, runtime }))
    );
  }
}

export const pluginRuntimeRegistry = new PluginRuntimeRegistry();

const createRuntimeForActivatedWorker = (input: {
  installation_id: string;
  plugin_id: string;
  pack_id: string;
  manifest: PluginManifest;
  granted_capabilities: string[];
  descriptors: ContributionDescriptor[];
  handlerNames: string[];
  worker_client: PluginWorkerClient;
}): RegisteredServerPluginRuntime => {
  const proxies = createWorkerContributionProxies(input.worker_client, input.descriptors);
  return {
    installation_id: input.installation_id,
    plugin_id: input.plugin_id,
    pack_id: input.pack_id,
    manifest: input.manifest,
    granted_capabilities: input.granted_capabilities,
    context_sources: proxies.context_sources,
    prompt_workflow_steps: proxies.prompt_workflow_steps,
    pack_routes: proxies.pack_routes,
    step_contributors: proxies.step_contributors,
    rule_contributors: proxies.rule_contributors,
    query_contributors: proxies.query_contributors,
    perception_resolvers: proxies.perception_resolvers,
    contribution_descriptors: input.descriptors,
    handler_names: input.handlerNames,
    loop_hook_points: input.descriptors
      .filter(d => d.type === 'loop_hook')
      .map(d => (d as { hookPoint: string }).hookPoint),
    worker_client: input.worker_client,
    deactivate: () => input.worker_client.deactivate()
  };
};

const registerRuntimeExtensionProxies = (runtime: RegisteredServerPluginRuntime): void => {
  if (!runtime.worker_client) return;
  const proxies = createWorkerContributionProxies(runtime.worker_client, runtime.contribution_descriptors);
  for (const cleaner of proxies.data_cleaners) {
    dataCleanerRegistry.register(cleaner, {
      packId: runtime.pack_id,
      installationId: runtime.installation_id,
      pluginId: runtime.plugin_id
    });
  }
  for (const evaluator of proxies.slot_condition_evaluators) {
    slotConditionRegistry.register(runtime.pack_id, evaluator);
  }
  for (const transformer of proxies.slot_content_transformers) {
    slotContentTransformRegistry.register(runtime.pack_id, transformer);
  }
};

export const syncPackPluginRuntime = async (
  context: Ctx,
  packId: string
): Promise<void> => {
  await refreshPackPluginRuntime(context, packId);
};

const parseSemver = (version: string): { major: number; minor: number; patch: number } | null => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: parseInt(match[1]!, 10),
    minor: parseInt(match[2]!, 10),
    patch: parseInt(match[3]!, 10)
  };
};

const isHostApiCompatible = (serverVersion: string, requiredVersion: string): boolean => {
  const server = parseSemver(serverVersion);
  const required = parseSemver(requiredVersion);
  if (!server || !required) return false;
  // Same major version, server >= required
  if (server.major !== required.major) return false;
  if (server.minor > required.minor) return true;
  if (server.minor === required.minor && server.patch >= required.patch) return true;
  return false;
};

export const refreshPackPluginRuntime = async (
  context: Ctx,
  packId: string
): Promise<void> => {
  const normalizedPackId = packId.trim();
  if (normalizedPackId.length === 0) {
    return;
  }

  const previousRuntimesByInstallation = new Map(
    pluginRuntimeRegistry
      .listRuntimes(normalizedPackId)
      .map(runtime => [runtime.installation_id, runtime])
  );

  const packLocalInstallations = await context.repos.plugin.listInstallationsByScope({
    scope_type: 'pack_local',
    scope_ref: normalizedPackId
  });

  const globalInstallations = await context.repos.plugin.listInstallationsByScope({
    scope_type: 'global'
  });

  const allInstallations = [...packLocalInstallations, ...globalInstallations];
  const enabledInstallations = allInstallations.filter(i => i.lifecycle_state === 'enabled');

  // Build manifest map for ordering
  const manifests = new Map<string, PluginManifest>();
  const artifactStore = new Map<string, { source_path: string }>();
  for (const inst of enabledInstallations) {
    const artifact = await context.repos.plugin.getArtifactById(inst.artifact_id);
    if (!artifact) continue;
    artifactStore.set(inst.installation_id, artifact);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    manifests.set(inst.installation_id, artifact.manifest_json as PluginManifest);
  }

  // Sort by load order
  const orderedInstallations = resolveLoadOrder({
    installations: enabledInstallations,
    manifests
  });

  const runtimes: RegisteredServerPluginRuntime[] = [];

  for (const installation of orderedInstallations) {
    const artifact = artifactStore.get(installation.installation_id);
    if (!artifact) continue;
    const previousRuntime = previousRuntimesByInstallation.get(installation.installation_id);

    const manifest = manifests.get(installation.installation_id);
    if (!manifest) continue;

    // Check Host API version compatibility
    const requiredHostApi = manifest.compatibility.host_api;
    if (requiredHostApi && !isHostApiCompatible(PLUGIN_HOST_API_VERSION, requiredHostApi)) {
      runtimeLogger.error(
        `Plugin ${installation.plugin_id} requires host_api ${requiredHostApi} ` +
        `but server provides ${PLUGIN_HOST_API_VERSION}. Skipping activation.`
      );
      await context.repos.plugin
        .upsertInstallation({
          installation_id: installation.installation_id,
          plugin_id: installation.plugin_id,
          artifact_id: installation.artifact_id,
          version: installation.version,
          scope_type: installation.scope_type,
          scope_ref: installation.scope_ref,
          lifecycle_state: installation.lifecycle_state,
          requested_capabilities: installation.requested_capabilities,
          granted_capabilities: installation.granted_capabilities,
          trust_mode: installation.trust_mode,
          confirmed_at: installation.confirmed_at,
          enabled_at: installation.enabled_at,
          disabled_at: installation.disabled_at,
          last_error: `Incompatible host_api: requires ${requiredHostApi}, server provides ${PLUGIN_HOST_API_VERSION}`
        })
        .catch((err: unknown) => {
          captureError(err, {
            module: 'plugin-runtime',
            message: 'Failed to persist plugin installation error',
            code: 'PLUGIN_PERSIST_FAIL'
          });
        });
      if (previousRuntime) {
        runtimes.push(previousRuntime);
      }
      continue;
    }

    const serverEntrypoint = manifest.entrypoints.server;
    if (!serverEntrypoint?.source) {
      runtimes.push({
        installation_id: installation.installation_id,
        plugin_id: installation.plugin_id,
        pack_id: normalizedPackId,
        manifest,
        granted_capabilities: installation.granted_capabilities,
        context_sources: [],
        prompt_workflow_steps: [],
        pack_routes: [],
        step_contributors: [],
        rule_contributors: [],
        query_contributors: [],
        perception_resolvers: [],
        contribution_descriptors: [],
        handler_names: [],
        loop_hook_points: []
      });
      continue;
    }

    try {
      const activated = await pluginWorkerManager.activateInstallation(context, {
        installation,
        manifest,
        artifactRoot: artifact.source_path,
        entrypointPath: resolvePluginEntrypointPath({
          artifactRoot: artifact.source_path,
          source: serverEntrypoint.source
        }),
        packId: normalizedPackId,
        hostApiVersion: PLUGIN_HOST_API_VERSION
      });

      runtimes.push(createRuntimeForActivatedWorker({
        installation_id: installation.installation_id,
        plugin_id: installation.plugin_id,
        pack_id: normalizedPackId,
        manifest,
        granted_capabilities: installation.granted_capabilities,
        descriptors: activated.descriptors,
        handlerNames: activated.handlerNames,
        worker_client: activated.client
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      runtimeLogger.error(
        `Plugin ${installation.plugin_id} (${installation.installation_id}) worker activation failed: ${message}`
      );
      if (previousRuntime) {
        runtimes.push(previousRuntime);
      }
    }
  }

  pluginRuntimeRegistry.replaceRuntimes(normalizedPackId, runtimes);
  dataCleanerRegistry.clearPack(normalizedPackId);
  slotConditionRegistry.clearPack(normalizedPackId);
  slotContentTransformRegistry.clearPack(normalizedPackId);
  for (const runtime of runtimes) {
    registerRuntimeExtensionProxies(runtime);
  }

  await pluginWorkerManager.replacePackWorkers(
    normalizedPackId,
    runtimes
      .map(runtime => runtime.worker_client)
      .filter((client): client is PluginWorkerClient => Boolean(client))
  );
  setPluginsActive(normalizedPackId, runtimes.length);
  setPluginWorkersActive(normalizedPackId, runtimes.filter(runtime => runtime.worker_client?.isAlive()).length);
};
