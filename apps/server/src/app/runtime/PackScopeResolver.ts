import type { PackRuntimeRegistry } from '../../core/pack_runtime_registry.js';
import { ApiError } from '../../utils/api_error.js';

export interface PackScope {
  packId: string;
}

export class PackScopeResolver {
  constructor(private readonly registry: PackRuntimeRegistry) {}

  public resolve(packId: string): PackScope {
    const normalized = packId.trim();
    if (normalized.length === 0) {
      throw new ApiError(400, 'PACK_ID_INVALID', 'Pack id is required');
    }

    const state = this.registry.getState(normalized);

    if (!state) {
      throw new ApiError(404, 'PACK_NOT_FOUND', `Pack "${normalized}" not found`);
    }

    switch (state.status) {
      case 'ready':
        return { packId: normalized };

      case 'loading':
        throw new ApiError(503, 'PACK_LOADING', `Pack "${normalized}" is still initializing`, {
          pack_id: normalized,
          retry_after: 2000
        });

      case 'unloading':
        throw new ApiError(503, 'PACK_UNLOADING', `Pack "${normalized}" is being unloaded`, {
          pack_id: normalized,
          retry_after: 2000
        });

      case 'degraded':
        throw new ApiError(503, 'PACK_DEGRADED', `Pack "${normalized}" is degraded: ${state.degradedReason ?? 'unknown reason'}`, {
          pack_id: normalized,
          degraded_reason: state.degradedReason ?? 'unknown'
        });

      case 'gone':
        throw new ApiError(404, 'PACK_GONE', `Pack "${normalized}" has been unloaded`);

      default:
        throw new ApiError(500, 'PACK_UNKNOWN_STATE', `Pack "${normalized}" is in an unknown state: ${String(state.status)}`);
    }
  }
}
