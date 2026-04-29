import type { PluginManifest } from '@yidhras/contracts';
import type { Express, Request, Response } from 'express';

import type { AppInfrastructure } from '../app/context.js';
import type {
  QueryContributor,
  RuleContributor,
  StepContributor
} from '../app/runtime/world_engine_contributors.js';
import type { ContextSourceAdapter } from '../context/source_registry.js';
import type { PromptWorkflowStepExecutor } from '../context/workflow/registry.js';
import { createPluginStore } from './store.js';

type Ctx = AppInfrastructure & { getHttpApp?(): Express | null };

export interface ServerPluginHostApi {
  registerContextSource(adapter: ContextSourceAdapter, capabilityKey?: string): void;
  registerPromptWorkflowStep(executor: PromptWorkflowStepExecutor, capabilityKey?: string): void;
  registerPackRoute(register: (app: Express, context: Ctx) => void, capabilityKey?: string): void;
  registerStepContributor(contributor: StepContributor, capabilityKey?: string): void;
  registerRuleContributor(contributor: RuleContributor, capabilityKey?: string): void;
  registerQueryContributor(contributor: QueryContributor, capabilityKey?: string): void;
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
}

const hasCapability = (grantedCapabilities: string[], capabilityKey: string | undefined): boolean => {
  if (!capabilityKey) {
    return true;
  }

  return grantedCapabilities.includes(capabilityKey);
};

const createServerPluginHostApi = (runtime: RegisteredServerPluginRuntime): ServerPluginHostApi => {
  return {
    registerContextSource(adapter, capabilityKey) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      runtime.context_sources.push(adapter);
    },
    registerPromptWorkflowStep(executor, capabilityKey) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      runtime.prompt_workflow_steps.push(executor);
    },
    registerPackRoute(register, capabilityKey) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      runtime.pack_routes.push(register);
    },
    registerStepContributor(contributor, capabilityKey) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      runtime.step_contributors.push(contributor);
    },
    registerRuleContributor(contributor, capabilityKey) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      runtime.rule_contributors.push(contributor);
    },
    registerQueryContributor(contributor, capabilityKey) {
      if (!hasCapability(runtime.granted_capabilities, capabilityKey)) {
        return;
      }

      runtime.query_contributors.push(contributor);
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
    query_contributors: []
  };
};

const registerManifestContributions = (runtime: RegisteredServerPluginRuntime): void => {
  const host = createServerPluginHostApi(runtime);

  for (const contextSourceId of runtime.manifest.contributions.server.context_sources) {
    host.registerContextSource(
      {
        name: `plugin:${runtime.plugin_id}:context_source:${contextSourceId}`,
        buildNodes() {
          return Promise.resolve([]);
        }
      },
      'server.context_source.register'
    );
  }

  for (const stepId of runtime.manifest.contributions.server.prompt_workflow_steps) {
    host.registerPromptWorkflowStep(
      {
        kind: 'bundle_finalize',
        execute(input) {
          return Promise.resolve({
            ...input.state,
            diagnostics: {
              ...input.state.diagnostics,
              step_traces: [
                ...input.state.diagnostics.step_traces,
                {
                  key: `plugin:${runtime.plugin_id}:${stepId}`,
                  kind: 'bundle_finalize',
                  status: 'completed',
                  before: {},
                  after: {},
                  notes: {
                    plugin_id: runtime.plugin_id,
                    contribution: stepId
                  }
                }
              ]
            }
          });
        }
      },
      'server.prompt_workflow.register'
    );
  }

  for (const routePath of runtime.manifest.contributions.server.api_routes) {
    host.registerPackRoute(
      (app, _context) => {
        app.get(routePath, (req: Request, res: Response) => {
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
      'server.api_route.register'
    );
  }
}

export const syncActivePackPluginRuntime = async (context: Ctx): Promise<void> => {
  const activePackId = context.activePack.getActivePack()?.metadata.id;
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

export const refreshActivePackPluginRuntime = async (context: Ctx): Promise<void> => {
  const activePack = context.activePack.getActivePack();
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

  const store = createPluginStore({ prisma: context.prisma });
  const installations = await store.listInstallationsByScope({
    scope_type: 'pack_local',
    scope_ref: normalizedPackId
  });

  const runtimes: RegisteredServerPluginRuntime[] = [];

  for (const installation of installations) {
    if (installation.lifecycle_state !== 'enabled') {
      continue;
    }

    const artifact = await store.getArtifactById(installation.artifact_id);
    if (!artifact) {
      continue;
    }

    const manifest = artifact.manifest_json as PluginManifest;
    const runtime = createRuntimeForManifest({
      installation_id: installation.installation_id,
      plugin_id: installation.plugin_id,
      pack_id: normalizedPackId,
      manifest,
      granted_capabilities: installation.granted_capabilities
    });
    registerManifestContributions(runtime);
    runtimes.push(runtime);
  }

  pluginRuntimeRegistry.clearRuntimes(normalizedPackId);
  pluginRuntimeRegistry.setRuntimes(normalizedPackId, runtimes);
};
