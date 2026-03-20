export type VariableValue =
  | string
  | number
  | boolean
  | {
      [key: string]: VariableValue;
    };

export type VariablePool = Record<string, VariableValue>;

export interface NarrativeConfig {
  variables: VariablePool;
  prompts: Record<string, string>;
}
