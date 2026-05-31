import { syncPackPluginRuntime } from '../../../plugins/runtime.js';
import type { DataContext, PortContext } from '../../context.js';
import type {
  PackPluginRuntimeWebSnapshot,
  ResolvedPluginWebAsset
} from '../plugin/plugin_runtime_web.js';
import {
  getPackPluginRuntimeWebSnapshot,
  resolveEnabledPluginWebAsset
} from '../plugin/plugin_runtime_web.js';

export interface GetPackPluginRuntimeSnapshotInput {
  pack_id: string;
}

export interface ResolvePackPluginAssetInput {
  pack_id: string;
  plugin_id: string;
  installation_id: string;
  asset_path: string;
}

export interface PackScopedPluginRuntimeService {
  getRuntimeWebSnapshot(input: GetPackPluginRuntimeSnapshotInput): Promise<PackPluginRuntimeWebSnapshot>;
  resolveEnabledPluginWebAsset(input: ResolvePackPluginAssetInput): Promise<ResolvedPluginWebAsset>;
  refreshPackRuntime(packId: string): Promise<void>;
}

export const createPackScopedPluginRuntimeService = (
  context: DataContext & PortContext
): PackScopedPluginRuntimeService => {
  return {
    async getRuntimeWebSnapshot(input: GetPackPluginRuntimeSnapshotInput): Promise<PackPluginRuntimeWebSnapshot> {
      return getPackPluginRuntimeWebSnapshot(context, input.pack_id);
    },

    async resolveEnabledPluginWebAsset(input: ResolvePackPluginAssetInput): Promise<ResolvedPluginWebAsset> {
      return resolveEnabledPluginWebAsset(context, input);
    },

    async refreshPackRuntime(packId: string): Promise<void> {
      const normalizedPackId = packId.trim();
      if (normalizedPackId.length === 0) {
        return;
      }

      await syncPackPluginRuntime(context, normalizedPackId);
    }
  };
};
