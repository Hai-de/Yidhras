import type { SpatialRuntime } from '../packs/runtime/spatial_runtime.js';

export interface ResolvePerceptionInput {
  eventId: string;
  eventTitle: string;
  eventDescription: string;
  locationId: string | null;
  visibility: string | null;
  eventActorEntityId: string | null;
}

export type PerceptionLevel = 'full' | 'partial' | 'none';

export interface PerceptionResult {
  level: PerceptionLevel;
  description?: string;
}

export interface PerceptionResolver {
  resolve(
    event: ResolvePerceptionInput,
    observerEntityId: string,
    spatialRuntime: SpatialRuntime
  ): Promise<PerceptionResult>;
}
