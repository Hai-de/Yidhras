import type { PluginManifest } from '@yidhras/contracts';

import type { ContextSourceAdapter } from '../../context/source_registry.js';
import type { PromptWorkflowStepExecutor } from '../../context/workflow/registry.js';
import type { PerceptionResolver } from '../../perception/types.js';
import type { PluginInferenceRequest, PluginInferenceResult } from '../../plugins/types.js';
import type { WorkerPackRouteProxy } from '../../plugins/worker/contribution_proxy.js';
import type { PluginWorkerClient } from '../../plugins/worker/PluginWorkerClient.js';
import type {
  QueryContributor,
  RuleContributor,
  StepContributor
} from './world_engine_contributors.js';

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
  contribution_descriptors: import('../../plugins/worker/contribution_descriptors.js').ContributionDescriptor[];
  handler_names: string[];
  loop_hook_points: string[];
  worker_client?: PluginWorkerClient;
  inferenceExecutor?: (input: PluginInferenceRequest) => Promise<PluginInferenceResult>;
  deactivate?: () => void | Promise<void>;
}

export class PluginRuntimeRegistry {
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
