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
  | `plugin.${string}`;

export type PromptVariableResolutionMode = 'namespaced' | 'local';
export type PromptVariableValueType = 'null' | 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';

export interface PromptVariableLayer {
  namespace: PromptVariableNamespace;
  values: PromptVariableRecord;
  alias_values?: Record<string, PromptVariableValue>;
  metadata?: {
    source_label: string;
    mutable?: boolean;
    trusted?: boolean;
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
  resolved_layer?: string;
  resolved_path?: string;
  fallback_applied?: boolean;
  missing?: boolean;
  restricted?: boolean;
  value_preview?: string;
  value_type?: PromptVariableValueType;
  notes?: string[];
}

export interface PromptMacroBlockTrace {
  kind: 'if' | 'each';
  expression: string;
  executed: boolean;
  iteration_count?: number;
  alias?: string;
}

export interface PromptMacroDiagnostics {
  template_source?: string;
  traces: PromptVariableResolutionTrace[];
  missing_paths: string[];
  restricted_paths: string[];
  blocks?: PromptMacroBlockTrace[];
  namespaces_used?: string[];
  output_length?: number;
}

export interface PromptMacroRenderResult {
  text: string;
  diagnostics: PromptMacroDiagnostics;
}
