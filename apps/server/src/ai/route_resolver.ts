import { ApiError } from '../utils/api_error.js';
import { getAiRegistryConfig } from './registry.js';
import type {
  AiModelRegistryEntry,
  AiModelSelector,
  AiRegistryConfig,
  AiResponseMode,
  AiRoutePolicy,
  AiRouteSelectionInput,
  AiRouteSelectionResult,
  AiTaskRouteHint
} from './types.js';

const LOCAL_MODEL_TAGS = new Set(['local', 'on_device', 'self_hosted']);

const isLocalModel = (entry: AiModelRegistryEntry): boolean => {
  return entry.tags.some(tag => LOCAL_MODEL_TAGS.has(tag));
};

const supportsResponseMode = (entry: AiModelRegistryEntry, responseMode: AiResponseMode): boolean => {
  switch (responseMode) {
    case 'free_text':
      return entry.capabilities.text_generation;
    case 'json_object':
      return (
        entry.capabilities.text_generation
        && (entry.capabilities.structured_output === 'json_object' || entry.capabilities.structured_output === 'json_schema')
      );
    case 'json_schema':
      return entry.capabilities.text_generation && entry.capabilities.structured_output === 'json_schema';
    case 'tool_call':
      return entry.capabilities.text_generation && entry.capabilities.tool_calling;
    case 'embedding':
      return entry.capabilities.embeddings;
    default:
      return false;
  }
};

const matchesSelector = (entry: AiModelRegistryEntry, selector: AiModelSelector): boolean => {
  if (selector.provider && entry.provider !== selector.provider) {
    return false;
  }

  if (selector.model && entry.model !== selector.model) {
    return false;
  }

  if (selector.tags && !selector.tags.every(tag => entry.tags.includes(tag))) {
    return false;
  }

  if (selector.exclude_tags && selector.exclude_tags.some(tag => entry.tags.includes(tag))) {
    return false;
  }

  return true;
};

const uniqueByModel = (entries: AiModelRegistryEntry[]): AiModelRegistryEntry[] => {
  const seen = new Set<string>();
  const result: AiModelRegistryEntry[] = [];

  for (const entry of entries) {
    const key = `${entry.provider}:${entry.model}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry);
  }

  return result;
};

const applyRouteConstraints = (
  entries: AiModelRegistryEntry[],
  route: AiRoutePolicy,
  responseMode?: AiResponseMode
): AiModelRegistryEntry[] => {
  return entries.filter(entry => {
    if (entry.availability === 'disabled') {
      return false;
    }

    if (route.constraints?.require_structured_output && entry.capabilities.structured_output === 'none') {
      return false;
    }

    if (route.constraints?.require_tool_calling && !entry.capabilities.tool_calling) {
      return false;
    }

    if ((route.constraints?.require_local_only || route.constraints?.privacy_tier === 'local_only') && !isLocalModel(entry)) {
      return false;
    }

    if (responseMode && !supportsResponseMode(entry, responseMode)) {
      return false;
    }

    if (route.constraints?.response_modes && route.constraints.response_modes.length > 0) {
      if (!responseMode) {
        return false;
      }
      if (!route.constraints.response_modes.includes(responseMode)) {
        return false;
      }
    }

    return true;
  });
};

const resolveModelsFromSelectors = (
  selectors: AiModelSelector[],
  registry: AiRegistryConfig,
  route: AiRoutePolicy,
  responseMode?: AiResponseMode
): AiModelRegistryEntry[] => {
  const matched = selectors.flatMap(selector => registry.models.filter(entry => matchesSelector(entry, selector)));
  return uniqueByModel(applyRouteConstraints(matched, route, responseMode));
};

const prioritizeByRouteHint = (
  entries: AiModelRegistryEntry[],
  hint: AiTaskRouteHint | null | undefined
): AiModelRegistryEntry[] => {
  if (!hint?.provider && !hint?.model) {
    return entries;
  }

  const preferred = entries.filter(entry => {
    if (hint.provider && entry.provider !== hint.provider) {
      return false;
    }
    if (hint.model && entry.model !== hint.model) {
      return false;
    }
    return true;
  });

  if (preferred.length === 0) {
    return entries;
  }

  const preferredKeySet = new Set(preferred.map(entry => `${entry.provider}:${entry.model}`));
  return [...preferred, ...entries.filter(entry => !preferredKeySet.has(`${entry.provider}:${entry.model}`))];
};

const selectRouteCandidate = (
  input: AiRouteSelectionInput,
  registry: AiRegistryConfig
): AiRoutePolicy => {
  const explicitRouteId = input.route_hint?.route_id ?? input.task_override?.route?.route_id;

  if (explicitRouteId) {
    const explicitRoute = registry.routes.find(route => route.route_id === explicitRouteId);
    if (!explicitRoute) {
      throw new ApiError(400, 'AI_ROUTE_NOT_FOUND', 'Explicit AI route does not exist', {
        route_id: explicitRouteId,
        task_type: input.task_type
      });
    }

    if (!explicitRoute.task_types.includes(input.task_type)) {
      throw new ApiError(400, 'AI_ROUTE_TASK_MISMATCH', 'Explicit AI route does not support the requested task type', {
        route_id: explicitRouteId,
        task_type: input.task_type,
        supported_task_types: explicitRoute.task_types
      });
    }

    return explicitRoute;
  }

  const candidates = registry.routes.filter(route => route.task_types.includes(input.task_type));
  const packAwareCandidates = candidates.filter(route => route.pack_id === input.pack_id || route.pack_id === undefined || route.pack_id === null);
  const sorted = [...packAwareCandidates].sort((left, right) => {
    const leftSpecificity = left.pack_id === input.pack_id ? 1 : 0;
    const rightSpecificity = right.pack_id === input.pack_id ? 1 : 0;
    return rightSpecificity - leftSpecificity;
  });

  const selected = sorted[0] ?? null;
  if (!selected) {
    throw new ApiError(400, 'AI_ROUTE_NOT_FOUND', 'No AI route is registered for the requested task type', {
      task_type: input.task_type,
      pack_id: input.pack_id ?? null
    });
  }

  return selected;
};

export const resolveAiRoute = (
  input: AiRouteSelectionInput,
  registry: AiRegistryConfig = getAiRegistryConfig()
): AiRouteSelectionResult => {
  const route = selectRouteCandidate(input, registry);
  const effectiveHint = input.route_hint ?? input.task_override?.route ?? null;

  const primaryCandidates = prioritizeByRouteHint(
    resolveModelsFromSelectors(route.preferred_models, registry, route, input.response_mode),
    effectiveHint
  );

  if (primaryCandidates.length === 0) {
    throw new ApiError(400, 'AI_ROUTE_NO_PRIMARY_MODEL', 'The selected AI route has no usable primary model candidates', {
      route_id: route.route_id,
      task_type: input.task_type,
      response_mode: input.response_mode ?? null
    });
  }

  const fallbackCandidates = prioritizeByRouteHint(
    resolveModelsFromSelectors(route.fallback_models, registry, route, input.response_mode),
    effectiveHint
  );

  return {
    route,
    primary_model_candidates: primaryCandidates,
    fallback_model_candidates: fallbackCandidates,
    applied_override: input.task_override ?? null
  };
};
