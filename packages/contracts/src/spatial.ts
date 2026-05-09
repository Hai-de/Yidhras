// Spatial model transport types.
// These mirror the Zod schemas in constitution_schema.ts and define the
// contract shape that crosses the server ↔ web boundary.

export interface SpatialLocation {
  id: string;
}

export interface SpatialEdge {
  from: string;
  to: string;
  type: 'bidirectional' | 'directed';
  weight: number;
}

export interface SpatialDiscreteConfig {
  model: 'discrete';
  locations: SpatialLocation[];
  edges: SpatialEdge[];
}
