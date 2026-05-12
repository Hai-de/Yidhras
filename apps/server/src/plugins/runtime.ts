import type { PluginManifest } from '@yidhras/contracts';
import type { Express, Request, Response } from 'express';
import path from 'path';

import type { AppInfrastructure } from '../app/context.js';
import { resolveActivePack } from '../app/services/pack_runtime_resolution.js';
import type {
  QueryContributor,
  RuleContributor,
  StepContributor
} from '../app/runtime/world_engine_contributors.js';
import type { ContextSourceAdapter } from '../context/source_registry.js';
import type { PromptWorkflowStepExecutor } from '../context/workflow/registry.js';
import type { PerceptionResolver } from '../perception/types.js';
import { createLogger } from '../utils/logger.js';
import {
  CAPABILITY_KEY_MIN_LEVEL,
  PLUGIN_CAPABILITY_KEY,
  PLUGIN_HOST_API_VERSION,
  type PluginCapabilityKey
} from './capability_keys.js';
import { getPluginSandboxConfig } from './context.js';
import { resolveLoadOrder } from './dependency_resolver.js';
import type { DataCleaner } from './extensions/data_cleaner_registry.js';
import { dataCleanerRegistry } from './extensions/data_cleaner_registry.js';
import type { SlotConditionEvaluator } from './extensions/slot_condition_registry.js';
import { slotConditionRegistry } from './extensions/slot_condition_registry.js';
import type { SlotContentTransformer } from './extensions/slot_content_transformer.js';
import { slotContentTransformRegistry } from './extensions/slot_content_transformer.js';

const runtimeLogger = createLogger('plugin-sandbox-runtime');

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
};

type Ctx = AppInfrastructure & { getHttpApp?(): Express | null };

export interface PluginInferenceRequest {
  purpose: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export interface PluginInferenceResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ServerPluginHostApi {
  registerContextSource(adapter: ContextSourceAdapter, capabilityKey?: string): void;
  registerPromptWorkflowStep(executor: PromptWorkflowStepExecutor, capabilityKey?: string): void;
  registerPackRoute(register: (app: Express, context: Ctx) => void, capabilityKey?: string): void;
  registerStepContributor(contributor: StepContributor, capabilityKey?: string): void;
  registerRuleContributor(contributor: RuleContributor, capabilityKey?: string): void;
  registerQueryContributor(contributor: QueryContributor, capabilityKey?: string): void;
  registerDataCleaner(cleaner: DataCleaner, capabilityKey?: string): void;
  registerSlotConditionEvaluator(evaluator: SlotConditionEvaluator, capabilityKey?: string): void;
  registerSlotContentTransformer(transformer: SlotContentTransformer, capabilityKey?: string): void;
  registerPerceptionResolver(resolver: PerceptionResolver, capabilityKey?: string): void;
  requestInference(input: PluginInferenceRequest): Promise<PluginInferenceResult>;
}

export interface RegisteredServerPluginRuntime {
  installation_id: string;
  plugin_id: string;
  pack_id: string;
  manifest: PluginManifest;
  granted_capabilities: string[];
  context_sources: ContextSourceAdapter[];
  prompt_workflow_steps: PromptWorkflowStepExecutor[];
  pack_routes: Array<(app: Express, context: Ctx) => void>;
  step_contributors: StepContributor[];
  rule_contributors: RuleContributor[];
  query_contributors: QueryContributor[];
  perception_resolvers: PerceptionResolver[];
  inferenceExecutor?: (input: PluginInferenceRequest) => Promise<PluginInferenceResult>;
  deactivate?: () => void | Promise<void>;
}

const hasCapability = (
  grantedCapabilities: string[],
  capabilityKey: string | undefined
): boolean => {
  if (!capabilityKey) {
    return true;
  }

  if (!grantedCapabilities.includes(capabilityKey)) {
    return false;
  }

  const sandboxLevel = getPluginSandboxConfig().capabilityLevel;
  if (sandboxLevel === 'full') {
    return true;
  }

  const requiredLevel = CAPABILITY_KEY_MIN_LEVEL[capabilityKey as PluginCapabilityKey] ?? 'pack_scoped';
  const levels = ['readonly', 'pack_scoped', 'full'] as const;
  return levels.indexOf(sandboxLevel) >= levels.indexOf(requiredLevel);
};

const createServerPluginHostApi = (runtime: RegisteredServerPluginRuntime): ServerPluginHostApi => {
  return {
    registerContextSource(adapter, capabilityKey = PLUGIN_CAPABILITY_KEY.CONTEXT_SOURCE_REGISTER) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      const config = getPluginSandboxConfig();
      if (runtime.context_sources.length >= config.maxContextSources) {
        runtimeLogger.warn(
          `Plugin ${runtime.plugin_id} (${runtime.installation_id}) exceeded max context sources ` +
          `(${config.maxContextSources}). Skipping context source registration.`
        );
        return;
      }

      runtime.context_sources.push(adapter);
    },
    registerPromptWorkflowStep(executor, capabilityKey = PLUGIN_CAPABILITY_KEY.PROMPT_WORKFLOW_REGISTER) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      runtime.prompt_workflow_steps.push(executor);
    },
    registerPackRoute(register, capabilityKey = PLUGIN_CAPABILITY_KEY.API_ROUTE_REGISTER) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      const config = getPluginSandboxConfig();
      if (runtime.pack_routes.length >= config.maxRoutes) {
        runtimeLogger.warn(
          `Plugin ${runtime.plugin_id} (${runtime.installation_id}) exceeded max routes ` +
          `(${config.maxRoutes}). Skipping route registration.`
        );
        return;
      }

      runtime.pack_routes.push(register);
    },
    registerStepContributor(contributor, capabilityKey = PLUGIN_CAPABILITY_KEY.STEP_CONTRIBUTOR_REGISTER) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      runtime.step_contributors.push(contributor);
    },
    registerRuleContributor(contributor, capabilityKey = PLUGIN_CAPABILITY_KEY.RULE_CONTRIBUTOR_REGISTER) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      runtime.rule_contributors.push(contributor);
    },
    registerQueryContributor(contributor, capabilityKey = PLUGIN_CAPABILITY_KEY.QUERY_CONTRIBUTOR_REGISTER) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      runtime.query_contributors.push(contributor);
    },
    registerDataCleaner(cleaner, capabilityKey = PLUGIN_CAPABILITY_KEY.DATA_CLEANER_REGISTER) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      dataCleanerRegistry.register(cleaner);
    },
    registerSlotConditionEvaluator(evaluator, capabilityKey = PLUGIN_CAPABILITY_KEY.SLOT_CONDITION_REGISTER) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      slotConditionRegistry.register(runtime.pack_id, evaluator);
    },
    registerSlotContentTransformer(transformer, capabilityKey = PLUGIN_CAPABILITY_KEY.SLOT_CONTENT_TRANSFORM_REGISTER) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      slotContentTransformRegistry.register(runtime.pack_id, transformer);
    },
    registerPerceptionResolver(resolver, capabilityKey = PLUGIN_CAPABILITY_KEY.PERCEPTION_RESOLVER_REGISTER) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      runtime.perception_resolvers.push(resolver);
    },
    async requestInference(input) {
      if (!hasCapability(runtime.granted_capabilities, PLUGIN_CAPABILITY_KEY.INFERENCE_REQUEST)) {
        throw new Error(`Plugin does not have capability: ${PLUGIN_CAPABILITY_KEY.INFERENCE_REQUEST}`);
      }
      if (!runtime.inferenceExecutor) {
        throw new Error('Inference executor not available for plugin runtime');
      }
      return withTimeout(
        runtime.inferenceExecutor(input),
        60000,
        `Plugin ${runtime.plugin_id} requestInference()`
      );
    }
  };
};

class PluginRuntimeRegistry {
  private runtimes = new Map<string, RegisteredServerPluginRuntime[]>();
  private appliedRouteKeys = new Set<string>();

  public setRuntimes(packId: string, runtimes: RegisteredServerPluginRuntime[]): void {
    this.runtimes.set(packId, runtimes);
  }

  public clearRuntimes(packId: string): void {
    const existing = this.runtimes.get(packId);
    if (existing) {
      for (const runtime of existing) {
        if (runtime.deactivate) {
          try {
            const result = runtime.deactivate();
            if (result instanceof Promise) {
              result.catch(() => {
                // Fire and forget — deactivate failure doesn't block cleanup
              });
            }
          } catch {
            // Deactivate failure doesn't block cleanup
          }
        }
      }
    }

    this.runtimes.delete(packId);
    for (const routeKey of Array.from(this.appliedRouteKeys)) {
      if (routeKey.startsWith(`${packId}:`)) {
        this.appliedRouteKeys.delete(routeKey);
      }
    }
  }

  public listRuntimes(packId: string): RegisteredServerPluginRuntime[] {
    return this.runtimes.get(packId) ?? [];
  }

  public getContextSourceAdapters(packId: string): ContextSourceAdapter[] {
    return this.listRuntimes(packId).flatMap(runtime => runtime.context_sources);
  }

  public getPromptWorkflowStepExecutors(packId: string): PromptWorkflowStepExecutor[] {
    return this.listRuntimes(packId).flatMap(runtime => runtime.prompt_workflow_steps);
  }

  public getStepContributors(packId: string): StepContributor[] {
    return this.listRuntimes(packId).flatMap(runtime => runtime.step_contributors);
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

  public applyPackRoutes(packId: string, app: Express, context: Ctx): void {
    for (const runtime of this.listRuntimes(packId)) {
      runtime.pack_routes.forEach((register, index) => {
        const routeKey = `${packId}:${runtime.installation_id}:${String(index)}`;
        if (this.appliedRouteKeys.has(routeKey)) {
          return;
        }

        register(app, context);
        this.appliedRouteKeys.add(routeKey);
      });
    }
  }
}

export const pluginRuntimeRegistry = new PluginRuntimeRegistry();

const createRuntimeForManifest = (input: {
  installation_id: string;
  plugin_id: string;
  pack_id: string;
  manifest: PluginManifest;
  granted_capabilities: string[];
}): RegisteredServerPluginRuntime => {
  return {
    installation_id: input.installation_id,
    plugin_id: input.plugin_id,
    pack_id: input.pack_id,
    manifest: input.manifest,
    granted_capabilities: input.granted_capabilities,
    context_sources: [],
    prompt_workflow_steps: [],
    pack_routes: [],
    step_contributors: [],
    rule_contributors: [],
    query_contributors: [],
    perception_resolvers: []
  };
};

const registerManifestContributions = (runtime: RegisteredServerPluginRuntime): void => {
  const host = createServerPluginHostApi(runtime);

  for (const cs of runtime.manifest.contributions.server.context_sources) {
    host.registerContextSource(
      {
        name: `plugin:${runtime.plugin_id}:context_source:${cs.name}`,
        buildNodes() {
          return Promise.resolve([]);
        }
      },
      PLUGIN_CAPABILITY_KEY.CONTEXT_SOURCE_REGISTER
    );
  }

  for (const pws of runtime.manifest.contributions.server.prompt_workflow_steps) {
    host.registerPromptWorkflowStep(
      {
        kind: pws.stepKind,
        execute(input) {
          return Promise.resolve({
            ...input.state,
            diagnostics: {
              ...input.state.diagnostics,
              step_traces: [
                ...input.state.diagnostics.step_traces,
                {
                  key: `plugin:${runtime.plugin_id}:${pws.name}`,
                  kind: pws.stepKind,
                  status: 'completed',
                  before: { section_drafts_count: 0, fragment_count: 0, total_estimated_tokens: 0, denied_fragment_count: 0, working_set_node_count: 0 },
                  after: { section_drafts_count: 0, fragment_count: 0, total_estimated_tokens: 0, denied_fragment_count: 0, working_set_node_count: 0 },
                  notes: {
                    plugin_id: runtime.plugin_id,
                    contribution: pws.name
                  }
                }
              ]
            }
          });
        }
      },
      PLUGIN_CAPABILITY_KEY.PROMPT_WORKFLOW_REGISTER
    );
  }

  for (const route of runtime.manifest.contributions.server.api_routes) {
    host.registerPackRoute(
      (app, _context) => {
        const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete';
        app[method](route.path, (req: Request, res: Response) => {
          if (req.params.packId !== runtime.pack_id || req.params.pluginId !== runtime.plugin_id) {
            res.status(409).json({
              success: false,
              error: { code: 'PLUGIN_ROUTE_SCOPE_MISMATCH', message: 'Plugin route scope does not match active pack-local runtime' }
            });
            return;
          }
          res.json({
            success: true,
            data: {
              plugin_id: runtime.plugin_id,
              installation_id: runtime.installation_id,
              route: req.path,
              pack_id: runtime.pack_id
            }
          });
        });
      },
      PLUGIN_CAPABILITY_KEY.API_ROUTE_REGISTER
    );
  }
}

export type PluginActivateResult = void | (() => void | Promise<void>) | {
  deactivate?: () => void | Promise<void>;
};

const activatePluginEntrypoint = async (
  entrypointPath: string,
  host: ServerPluginHostApi
): Promise<PluginActivateResult> => {
  const module = await import(entrypointPath) as { activate?: (host: ServerPluginHostApi) => PluginActivateResult | Promise<PluginActivateResult> };

  if (typeof module.activate === 'function') {
    return module.activate(host);
  }
};

export const syncActivePackPluginRuntime = async (context: Ctx): Promise<void> => {
  const activePackId = resolveActivePack(context)?.metadata.id;
  if (!activePackId) {
    return;
  }

  await refreshPackPluginRuntime(context, activePackId);

  const app = context.getHttpApp?.() ?? null;
  if (!app) {
    return;
  }

  pluginRuntimeRegistry.applyPackRoutes(activePackId, app, context);
};

export const syncExperimentalPackPluginRuntime = async (
  context: Ctx,
  packId: string
): Promise<void> => {
  await refreshPackPluginRuntime(context, packId);

  const app = context.getHttpApp?.() ?? null;
  if (!app) {
    return;
  }

  pluginRuntimeRegistry.applyPackRoutes(packId, app, context);
};

const parseSemver = (version: string): { major: number; minor: number; patch: number } | null => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10)
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

export const refreshActivePackPluginRuntime = async (context: Ctx): Promise<void> => {
  const activePack = resolveActivePack(context);
  if (!activePack) {
    return;
  }

  await refreshPackPluginRuntime(context, activePack.metadata.id);
};

export const refreshPackPluginRuntime = async (
  context: Ctx,
  packId: string
): Promise<void> => {
  const normalizedPackId = packId.trim();
  if (normalizedPackId.length === 0) {
    return;
  }

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

    const manifest = manifests.get(installation.installation_id);
    if (!manifest) continue;

    // Check Host API version compatibility
    const requiredHostApi = manifest.compatibility.host_api;
    if (!isHostApiCompatible(PLUGIN_HOST_API_VERSION, requiredHostApi)) {
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
        .catch(() => {});
      continue;
    }

    const runtime = createRuntimeForManifest({
      installation_id: installation.installation_id,
      plugin_id: installation.plugin_id,
      pack_id: normalizedPackId,
      manifest,
      granted_capabilities: installation.granted_capabilities
    });
    registerManifestContributions(runtime);
    runtimes.push(runtime);

    if (context.requestPluginInference) {
      runtime.inferenceExecutor = (input) => context.requestPluginInference!(input);
    }

    // Load server entrypoint for plugins that have one
    const serverEntrypoint = manifest.entrypoints?.server;
    if (serverEntrypoint?.source) {
      try {
        const entrypointPath = path.join(artifact.source_path, serverEntrypoint.source);
        const host = createServerPluginHostApi(runtime);
        const result = await withTimeout(
          activatePluginEntrypoint(entrypointPath, host),
          30000,
          `Plugin ${installation.plugin_id} activate()`
        );
        if (typeof result === 'function') {
          runtime.deactivate = result;
        } else if (result && typeof (result as { deactivate?: () => void }).deactivate === 'function') {
          runtime.deactivate = (result as { deactivate: () => void | Promise<void> }).deactivate;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        runtimeLogger.error(
          `Plugin ${installation.plugin_id} (${installation.installation_id}) activate() failed: ${message}`
        );
        // Fire and forget — persist last_error without blocking the refresh loop
        context.repos.plugin
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
            last_error: message
          })
          .catch((upsertErr) => {
            runtimeLogger.error(
              `Failed to persist last_error for ${installation.plugin_id}: ${upsertErr instanceof Error ? upsertErr.message : String(upsertErr)}`
            );
          });
      }
    }
  }

  pluginRuntimeRegistry.clearRuntimes(normalizedPackId);
  pluginRuntimeRegistry.setRuntimes(normalizedPackId, runtimes);
};
