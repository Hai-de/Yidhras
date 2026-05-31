import { pluginRuntimeRegistry } from './plugin_runtime_registry.js';
import type {
  QueryContribution,
  QueryContributor,
  RuleContribution,
  RuleContributor,
  WorldEngineSessionContext
} from './world_engine_contributors.js';

export interface PluginRuleAdapter {
  getContributors(packId: string): RuleContributor[];
  findFirstMatch(
    packId: string,
    input: Parameters<RuleContributor['contributeExecution']>[0],
    context: WorldEngineSessionContext
  ): Promise<RuleContribution | null>;
}

export interface PluginQueryAdapter {
  getContributors(packId: string): QueryContributor[];
  findFirstMatch(
    packId: string,
    input: Parameters<QueryContributor['contributeQuery']>[0],
    context: WorldEngineSessionContext
  ): Promise<QueryContribution | null>;
}

export const createPluginRuleAdapter = (): PluginRuleAdapter => ({
  getContributors(packId) {
    return pluginRuntimeRegistry.getRuleContributors(packId);
  },

  async findFirstMatch(packId, input, context) {
    const contributors = pluginRuntimeRegistry.getRuleContributors(packId);
    for (const contributor of contributors) {
      try {
        const result = await contributor.contributeExecution(input, context);
        if (result) return result;
      } catch {
        // Contributor failure → try next
      }
    }
    return null;
  }
});

export const createPluginQueryAdapter = (): PluginQueryAdapter => ({
  getContributors(packId) {
    return pluginRuntimeRegistry.getQueryContributors(packId);
  },

  async findFirstMatch(packId, input, context) {
    const contributors = pluginRuntimeRegistry.getQueryContributors(packId);
    for (const contributor of contributors) {
      if (
        contributor.supports_query_name !== '*' &&
        contributor.supports_query_name !== input.query_name
      ) {
        continue;
      }
      try {
        const result = await contributor.contributeQuery(input, context);
        if (result) return result;
      } catch {
        // Contributor failure → try next
      }
    }
    return null;
  }
});
