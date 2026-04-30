import type {
  PromptMacroDiagnostics,
  PromptVariableContext,
  PromptVariableContextSummary,
  PromptVariableLayer,
  PromptVariableNamespace,
  PromptVariableRecord,
  PromptVariableResolutionMode,
  PromptVariableResolutionTrace,
  PromptVariableValue,
  PromptVariableValueType
} from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

export const DEFAULT_PROMPT_VARIABLE_CONTEXT: PromptVariableContext = {
  layers: []
};

export const createPromptVariableLayer = (input: {
  namespace: PromptVariableNamespace;
  values?: PromptVariableRecord;
  alias_values?: Record<string, PromptVariableValue>;
  metadata?: PromptVariableLayer['metadata'];
}): PromptVariableLayer => ({
  namespace: input.namespace,
  values: input.values ?? {},
  alias_values: input.alias_values,
  metadata: input.metadata
});

export const createPromptVariableContext = (input?: Partial<PromptVariableContext>): PromptVariableContext => ({
  layers: input?.layers ? [...input.layers] : []
});

const toPromptVariableValue = (value: unknown): PromptVariableValue => {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(entry => toPromptVariableValue(entry));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toPromptVariableValue(entry)]));
  }
  return JSON.stringify(value) ?? String(value as string | number | boolean | bigint | symbol | null | undefined);
};

export const normalizePromptVariableRecord = (value: Record<string, unknown> | null | undefined): PromptVariableRecord => {
  if (!value) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toPromptVariableValue(entry)]));
};

export const createPromptVariableContextSummary = (
  context: PromptVariableContext
): PromptVariableContextSummary => ({
  namespaces: context.layers.map(layer => layer.namespace),
  layer_count: context.layers.length
});

export const flattenPromptVariableContextToVisibleVariables = (
  context: PromptVariableContext
): PromptVariableRecord => {
  const result: PromptVariableRecord = {};

  for (const layer of context.layers) {
    for (const [key, value] of Object.entries(layer.alias_values ?? {})) {
      if (!(key in result)) {
        // eslint-disable-next-line security/detect-object-injection
        result[key] = value;
      }
    }
  }

  return result;
};

export const detectPromptVariableValueType = (value: unknown): PromptVariableValueType => {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return 'unknown';
  }
};

export const previewPromptVariableValue = (value: unknown, maxLength = 160): string => {
  const rendered = (() => {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      return String(value);
    }
    if (Array.isArray(value)) {
      return `[array:${value.length}] ${JSON.stringify(value.slice(0, 3))}`;
    }
    if (isRecord(value)) {
      const keys = Object.keys(value);
      return `[object:${keys.length}] ${keys.slice(0, 8).join(', ')}`;
    }
    return JSON.stringify(value) ?? String(value as string | number | boolean | bigint | symbol | null | undefined);
  })();

  return rendered.length > maxLength ? `${rendered.slice(0, maxLength)}…` : rendered;
};

const getValueAtPath = (path: string, value: unknown): unknown => {
  if (!path) {
    return value;
  }

  return path.split('.').reduce<unknown>((current, segment) => {
    if (isRecord(current) && segment in current) {
      // eslint-disable-next-line security/detect-object-injection
      return current[segment];
    }
    return undefined;
  }, value);
};

const splitNamespacePath = (path: string): { namespace: string; relativePath: string } | null => {
  if (!path.includes('.')) {
    return null;
  }

  const segments = path.split('.');
  if (segments[0] === 'plugin' && segments.length >= 3) {
    return {
      namespace: `plugin.${segments[1]}`,
      relativePath: segments.slice(2).join('.')
    };
  }

  return {
    namespace: segments[0],
    relativePath: segments.slice(1).join('.')
  };
};

const getLayerByNamespace = (
  context: PromptVariableContext,
  namespace: string
): PromptVariableLayer | null => {
  return context.layers.find(layer => layer.namespace === namespace) ?? null;
};

export interface PromptVariableLookupResult {
  value: unknown;
  trace: PromptVariableResolutionTrace;
}

export const lookupPromptVariable = (input: {
  expression: string;
  path: string;
  context: PromptVariableContext;
  localScope?: Record<string, unknown>;
}): PromptVariableLookupResult => {
  const localScope = input.localScope ?? {};

  if (input.path.includes('.') && !input.path.startsWith('plugin.')) {
    const localResolved = getValueAtPath(input.path, localScope);
    if (localResolved !== undefined) {
      return {
        value: localResolved,
        trace: {
          expression: input.expression,
          requested_path: input.path,
          resolution_mode: 'local',
          resolved: true,
          resolved_layer: 'local',
          resolved_path: input.path,
          fallback_applied: false,
          value_preview: previewPromptVariableValue(localResolved),
          value_type: detectPromptVariableValueType(localResolved)
        }
      };
    }
  }

  const namespacePath = splitNamespacePath(input.path);
  if (namespacePath) {
    const layer = getLayerByNamespace(input.context, namespacePath.namespace);
    const resolved = layer ? getValueAtPath(namespacePath.relativePath, layer.values) : undefined;

    return {
      value: resolved,
      trace: {
        expression: input.expression,
        requested_path: input.path,
        resolution_mode: 'namespaced',
        resolved: resolved !== undefined,
        resolved_layer: resolved !== undefined ? namespacePath.namespace : undefined,
        resolved_path: resolved !== undefined ? input.path : undefined,
        fallback_applied: false,
        missing: resolved === undefined,
        value_preview: resolved !== undefined ? previewPromptVariableValue(resolved) : undefined,
        value_type: resolved !== undefined ? detectPromptVariableValueType(resolved) : undefined
      }
    };
  }

  const localResolved = getValueAtPath(input.path, localScope);
  if (localResolved !== undefined) {
    return {
      value: localResolved,
      trace: {
        expression: input.expression,
        requested_path: input.path,
        resolution_mode: 'local',
        resolved: true,
        resolved_layer: 'local',
        resolved_path: input.path,
        fallback_applied: false,
        value_preview: previewPromptVariableValue(localResolved),
        value_type: detectPromptVariableValueType(localResolved)
      }
    };
  }

  return {
    value: undefined,
    trace: {
      expression: input.expression,
      requested_path: input.path,
      resolution_mode: 'namespaced',
      resolved: false,
      missing: true
    }
  };
};

export const mergePromptMacroDiagnostics = (
  left: PromptMacroDiagnostics,
  right: PromptMacroDiagnostics
): PromptMacroDiagnostics => {
  const namespaces = new Set([...(left.namespaces_used ?? []), ...(right.namespaces_used ?? [])]);

  return {
    template_source: right.template_source ?? left.template_source,
    traces: [...left.traces, ...right.traces],
    missing_paths: Array.from(new Set([...left.missing_paths, ...right.missing_paths])),
    restricted_paths: Array.from(new Set([...left.restricted_paths, ...right.restricted_paths])),
    blocks: [...(left.blocks ?? []), ...(right.blocks ?? [])],
    namespaces_used: Array.from(namespaces),
    output_length: right.output_length ?? left.output_length
  };
};

export const collectNamespacesFromTrace = (
  trace: PromptVariableResolutionTrace
): string[] => {
  if (!trace.resolved_layer) {
    return [];
  }
  return [trace.resolved_layer];
};

export const buildEmptyPromptMacroDiagnostics = (templateSource?: string): PromptMacroDiagnostics => ({
  template_source: templateSource,
  traces: [],
  missing_paths: [],
  restricted_paths: [],
  blocks: [],
  namespaces_used: [],
  output_length: 0
});

export const resolvePromptVariableResolutionMode = (
  path: string,
  localScope?: Record<string, unknown>
): PromptVariableResolutionMode => {
  if (getValueAtPath(path, localScope ?? {}) !== undefined) {
    return 'local';
  }
  return 'namespaced';
};
