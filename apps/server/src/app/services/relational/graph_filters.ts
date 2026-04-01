import { ApiError } from '../../../utils/api_error.js'
import {
  DEFAULT_GRAPH_DEPTH,
  GRAPH_NODE_KINDS,
  type GraphViewInput,
  MAX_GRAPH_DEPTH} from './types.js'

export interface ParsedGraphViewFilters {
  view: 'mesh' | 'tree';
  depth: number;
  kinds: Array<(typeof GRAPH_NODE_KINDS)[number]> | null;
  rootId: string | null;
  search: string | null;
  includeInactive: boolean;
  includeUnresolved: boolean;
}

export const parseGraphView = (value: string | undefined): 'mesh' | 'tree' => {
  return value === 'tree' ? 'tree' : 'mesh';
};

export const parseGraphDepth = (value: number | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_GRAPH_DEPTH;
  }

  return Math.min(MAX_GRAPH_DEPTH, Math.max(0, Math.trunc(value)));
};

export const parseGraphKinds = (value: string[] | undefined): Array<(typeof GRAPH_NODE_KINDS)[number]> | null => {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const normalized = Array.from(
    new Set(
      value
        .map(item => item.trim())
        .filter(item => item.length > 0)
    )
  );

  if (normalized.length === 0) {
    return null;
  }

  const invalidKinds = normalized.filter(item => !(GRAPH_NODE_KINDS as readonly string[]).includes(item));
  if (invalidKinds.length > 0) {
    throw new ApiError(400, 'GRAPH_VIEW_QUERY_INVALID', 'kinds contains unsupported graph node kind', {
      invalid_kinds: invalidKinds,
      allowed_kinds: GRAPH_NODE_KINDS
    });
  }

  return normalized as Array<(typeof GRAPH_NODE_KINDS)[number]>;
};

export const normalizeSearch = (value: string | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
};

export const parseGraphViewFilters = (input: GraphViewInput): ParsedGraphViewFilters => {
  return {
    view: parseGraphView(input.view),
    depth: parseGraphDepth(input.depth),
    kinds: parseGraphKinds(input.kinds),
    rootId: typeof input.root_id === 'string' && input.root_id.trim().length > 0 ? input.root_id.trim() : null,
    search: normalizeSearch(input.search),
    includeInactive: input.include_inactive === true,
    includeUnresolved: input.include_unresolved !== false
  };
};
