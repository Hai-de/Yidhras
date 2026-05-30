export type PromptVariableScalar = string | number | boolean | null;
export type PromptVariableValue =
  | PromptVariableScalar
  | PromptVariableValue[]
  | {
      [key: string]: PromptVariableValue;
    };

export type PromptVariableRecord = Record<string, PromptVariableValue>;

export type PromptVariableNamespace =
  | 'system'
  | 'app'
  | 'pack'
  | 'runtime'
  | 'actor'
  | 'actor_state'
  | 'request'
  | `plugin.${string}`
  | 'previous_agent_output';

export type PromptVariableResolutionMode = 'namespaced' | 'local';
export type PromptVariableValueType = 'null' | 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';

export interface PromptVariableLayer {
  namespace: PromptVariableNamespace;
  values: PromptVariableRecord;
  alias_values?: Record<string, PromptVariableValue> | undefined;
  metadata?: {
    source_label: string;
    mutable?: boolean | undefined;
    trusted?: boolean | undefined;
  };
}

export interface PromptVariableContext {
  layers: PromptVariableLayer[];
}

export interface PromptVariableContextSummary {
  namespaces: string[];
  layer_count: number;
}

export interface PromptVariableResolutionTrace {
  expression: string;
  resolution_mode: PromptVariableResolutionMode;
  requested_path: string;
  resolved: boolean;
  resolved_layer?: string | undefined;
  resolved_path?: string | undefined;
  fallback_applied?: boolean | undefined;
  missing?: boolean | undefined;
  restricted?: boolean | undefined;
  value_preview?: string | undefined;
  value_type?: PromptVariableValueType | undefined;
  notes?: string[] | undefined;
}

export interface PromptMacroBlockTrace {
  kind: 'if' | 'each';
  expression: string;
  executed: boolean;
  iteration_count?: number | undefined;
  alias?: string | undefined;
}

export interface PromptMacroDiagnostics {
  template_source?: string | undefined;
  traces: PromptVariableResolutionTrace[];
  missing_paths: string[];
  restricted_paths: string[];
  blocks?: PromptMacroBlockTrace[] | undefined;
  namespaces_used?: string[] | undefined;
  output_length?: number | undefined;
}

export interface PromptMacroRenderResult {
  text: string;
  diagnostics: PromptMacroDiagnostics;
}
