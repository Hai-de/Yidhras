import { refreshPackPluginRuntime, syncActivePackPluginRuntime } from '../../plugins/runtime.js';
import type { AppContext } from '../context.js';
import { getPackRuntimeLookupPort } from './app_context_ports.js';
import type {
  ActivePackPluginRuntimeWebSnapshot,
  ResolvedPluginWebAsset
} from './plugin_runtime_web.js';
import {
  getActivePackPluginRuntimeWebSnapshot,
  getExperimentalPackPluginRuntimeWebSnapshot,
  resolveEnabledPluginWebAsset,
  resolveExperimentalEnabledPluginWebAsset
} from './plugin_runtime_web.js';

export type PluginRuntimeScopeMode = 'stable' | 'experimental';

export interface GetPackPluginRuntimeSnapshotInput {
  pack_id: string;
  mode: PluginRuntimeScopeMode;
}

export interface ResolvePackPluginAssetInput {
  pack_id: string;
  plugin_id: string;
  installation_id: string;
  asset_path: string;
  mode: PluginRuntimeScopeMode;
}

export interface PackScopedPluginRuntimeService {
  getRuntimeWebSnapshot(input: GetPackPluginRuntimeSnapshotInput): Promise<ActivePackPluginRuntimeWebSnapshot>;
  resolveEnabledPluginWebAsset(input: ResolvePackPluginAssetInput): Promise<ResolvedPluginWebAsset>;
  refreshPackRuntime(packId: string): Promise<void>;
}

export const createPackScopedPluginRuntimeService = (
  context: AppContext
): PackScopedPluginRuntimeService => {
  return {
    async getRuntimeWebSnapshot(input: GetPackPluginRuntimeSnapshotInput): Promise<ActivePackPluginRuntimeWebSnapshot> {
      return input.mode === 'experimental'
        ? getExperimentalPackPluginRuntimeWebSnapshot(context, input.pack_id)
        : getActivePackPluginRuntimeWebSnapshot(context, input.pack_id);
    },

    async resolveEnabledPluginWebAsset(input: ResolvePackPluginAssetInput): Promise<ResolvedPluginWebAsset> {
      return input.mode === 'experimental'
        ? resolveExperimentalEnabledPluginWebAsset(context, input)
        : resolveEnabledPluginWebAsset(context, input);
    },

    async refreshPackRuntime(packId: string): Promise<void> {
      const normalizedPackId = packId.trim();
      if (normalizedPackId.length === 0) {
        return;
      }

      const lookup = getPackRuntimeLookupPort({
        packRuntimeLookup: context.packRuntimeLookup
      });
      if (lookup.getActivePackId() === normalizedPackId) {
        await syncActivePackPluginRuntime(context);
        return;
      }

      if (lookup.hasPackRuntime(normalizedPackId)) {
        await refreshPackPluginRuntime(context, normalizedPackId);
      }
    }
  };
};
