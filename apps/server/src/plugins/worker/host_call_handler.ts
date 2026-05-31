import type { WorldStateQuery } from '@yidhras/contracts';

import type { AppContext } from '../../app/context.js';
import { getPackHostApi } from '../../app/services/app_context_ports.js';
import { listDeclaredPackCollectionRecords, upsertDeclaredPackCollectionRecord } from '../../packs/storage/pack_collection_repo.js';
import { ApiError } from '../../utils/api_error.js';
import { PLUGIN_CAPABILITY_KEY } from '../capability_keys.js';
import type { PluginInferenceRequest } from '../types.js';
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      return context.appContext.requestPluginInference(payload as PluginInferenceRequest);
    }

    case 'getPackSummary': {
      return getPackHostApi(context.appContext).getPackSummary({ pack_id: context.packId });
    }

    case 'getCurrentTick': {
      return getPackHostApi(context.appContext).getCurrentTick({ pack_id: context.packId });
    }

    case 'queryWorldState': {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
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

    case 'upsertPackCollectionRecord': {
      if (!hasCapability(context.grantedCapabilities, PLUGIN_CAPABILITY_KEY.PACK_STORAGE_ACCESS)) {
        throw new ApiError(403, 'PLUGIN_CAPABILITY_DENIED', 'Plugin does not have pack storage capability', {
          plugin_id: context.pluginId,
          installation_id: context.installationId,
          capability: PLUGIN_CAPABILITY_KEY.PACK_STORAGE_ACCESS
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      const storagePayload = payload as { collectionKey: string; record: Record<string, unknown> };
      await upsertDeclaredPackCollectionRecord(
        context.packId,
        storagePayload.collectionKey,
         
        storagePayload.record
      );
      return null;
    }

    case 'listPackCollectionRecords': {
      if (!hasCapability(context.grantedCapabilities, PLUGIN_CAPABILITY_KEY.PACK_STORAGE_ACCESS)) {
        throw new ApiError(403, 'PLUGIN_CAPABILITY_DENIED', 'Plugin does not have pack storage capability', {
          plugin_id: context.pluginId,
          installation_id: context.installationId,
          capability: PLUGIN_CAPABILITY_KEY.PACK_STORAGE_ACCESS
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      const listPayload = payload as { collectionKey: string };
      return listDeclaredPackCollectionRecords(
        context.packId,
        listPayload.collectionKey
      );
    }

    case 'emitPackEvent': {
      if (!hasCapability(context.grantedCapabilities, PLUGIN_CAPABILITY_KEY.PACK_EVENT_EMIT)) {
        throw new ApiError(403, 'PLUGIN_CAPABILITY_DENIED', 'Plugin does not have pack event capability', {
          plugin_id: context.pluginId,
          installation_id: context.installationId,
          capability: PLUGIN_CAPABILITY_KEY.PACK_EVENT_EMIT
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      const eventPayload = payload as {
        title: string;
        description: string;
        type: string;
        impact_data?: Record<string, unknown>;
        location_id?: string;
        visibility?: string;
      };
      const now = BigInt(Date.now());
      const tickResponse = await getPackHostApi(context.appContext).getCurrentTick({ pack_id: context.packId });
      const tick = BigInt(tickResponse ?? '0');
      await context.appContext.repos.inference.transaction(async tx => {
        await tx.event.create({
          data: {
            title: eventPayload.title,
            description: eventPayload.description,
            tick,
            type: eventPayload.type,
            pack_id: context.packId,
            impact_data: eventPayload.impact_data ? JSON.stringify(eventPayload.impact_data) : null,
            location_id: eventPayload.location_id ?? null,
            visibility: eventPayload.visibility ?? 'public',
            created_at: now
          }
        });
      });
      return null;
    }
  }
};
