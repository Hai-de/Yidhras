import type { WorldStateQuery } from '@yidhras/contracts';

import type { AppContext } from '../../app/context.js';
import { getPackHostApi } from '../../app/services/app_context_ports.js';
import { ApiError } from '../../utils/api_error.js';
import { PLUGIN_CAPABILITY_KEY } from '../capability_keys.js';
import type { PluginInferenceRequest } from '../runtime.js';
import type { HostMethodName } from './protocol.js';

const hasCapability = (grantedCapabilities: string[], capabilityKey: string): boolean => {
  return grantedCapabilities.includes(capabilityKey);
};

export interface PluginHostCallContext {
  appContext: AppContext;
  packId: string;
  pluginId: string;
  installationId: string;
  grantedCapabilities: string[];
}

export const handlePluginWorkerHostCall = async (
  context: PluginHostCallContext,
  method: HostMethodName,
  payload: unknown
): Promise<unknown> => {
  switch (method) {
    case 'requestInference': {
      if (!hasCapability(context.grantedCapabilities, PLUGIN_CAPABILITY_KEY.INFERENCE_REQUEST)) {
        throw new ApiError(403, 'PLUGIN_CAPABILITY_DENIED', 'Plugin does not have inference capability', {
          plugin_id: context.pluginId,
          installation_id: context.installationId,
          capability: PLUGIN_CAPABILITY_KEY.INFERENCE_REQUEST
        });
      }
      if (!context.appContext.requestPluginInference) {
        throw new ApiError(501, 'PLUGIN_INFERENCE_UNAVAILABLE', 'Plugin inference executor is not available');
      }
      return context.appContext.requestPluginInference(payload as PluginInferenceRequest);
    }

    case 'getPackSummary': {
      return getPackHostApi(context.appContext).getPackSummary({ pack_id: context.packId });
    }

    case 'getCurrentTick': {
      return getPackHostApi(context.appContext).getCurrentTick({ pack_id: context.packId });
    }

    case 'queryWorldState': {
      const query = payload as WorldStateQuery;
      if (query.pack_id !== context.packId) {
        throw new ApiError(403, 'PLUGIN_PACK_SCOPE_DENIED', 'Plugin cannot query a different pack', {
          plugin_id: context.pluginId,
          installation_id: context.installationId,
          requested_pack_id: query.pack_id,
          pack_id: context.packId
        });
      }
      return getPackHostApi(context.appContext).queryWorldState(query);
    }

    case 'emitLog': {
      return null;
    }
  }
};
