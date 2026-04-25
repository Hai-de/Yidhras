import type { PromptFragmentPermissions } from './prompt_fragment_v2.js';

/**
 * 单个 Slot 的声明式配置。
 * 来自 YAML 配置文件（如 prompt_slots.yaml）或 World Pack 的 pack.ai.slots。
 */
export interface PromptSlotConfig {
  id: string;
  display_name: string;
  description?: string;
  default_priority: number;
  default_template?: string | null;
  template_context?: 'inference' | 'world_prompts' | 'pack_state' | 'none';
  message_role?: 'system' | 'developer' | 'user';
  include_in_combined: boolean;
  combined_heading?: string | null;
  permissions?: PromptFragmentPermissions | null;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface PromptSlotRegistry {
  version: number;
  slots: Record<string, PromptSlotConfig>;
  metadata?: PromptSlotRegistryMetadata;
}

export interface PromptSlotRegistryMetadata {
  workspace_root?: string;
  config_path?: string;
  loaded_from_file?: boolean;
}
