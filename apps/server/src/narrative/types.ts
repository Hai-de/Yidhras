export type VariableValue =
  | string
  | number
  | boolean
  | {
      [key: string]: VariableValue;
    };

export type VariablePool = Record<string, VariableValue>;

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

export const DEFAULT_PROMPT_VARIABLE_ALIAS_PRECEDENCE = ['request', 'actor', 'runtime', 'pack', 'app', 'system'] as const;

export type PromptVariableAliasNamespace = (typeof DEFAULT_PROMPT_VARIABLE_ALIAS_PRECEDENCE)[number];
export type PromptVariableResolutionMode = 'namespaced' | 'alias_fallback' | 'local';
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
  alias_precedence: PromptVariableAliasNamespace[];
  strict_namespace: boolean;
}

export interface PromptVariableContextSummary {
  namespaces: string[];
  alias_precedence: string[];
  strict_namespace: boolean;
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
  alias_fallback_count?: number;
  namespaces_used?: string[];
  output_length?: number;
}

export interface PromptMacroRenderResult {
  text: string;
  diagnostics: PromptMacroDiagnostics;
}

export interface NarrativeConfig {
  variables: VariablePool;
  prompts: Record<string, string>;
}
