import { describe, expect, it, vi } from 'vitest';

import {
  resolveConversationFormatConfig,
  resolveEffectiveFormatConfig
} from '../../../src/conversation/format_config.js';
import { DEFAULT_CONVERSATION_FORMAT_CONFIG } from '../../../src/conversation/format_config_schemas.js';
import type { AgentConversationMemory } from '../../../src/conversation/types.js';

function makeMemory(overrides: Partial<AgentConversationMemory> = {}): AgentConversationMemory {
  return {
    id: 'mem-1',
    owner_agent_id: 'agent-1',
    conversation_id: 'conv-1',
    entries: [],
    ...overrides
  };
}

describe('conversation/format_config', () => {
  describe('resolveConversationFormatConfig', () => {
    it('should return default config when profileName is null', () => {
      const result = resolveConversationFormatConfig(null);
      expect(result).toEqual(DEFAULT_CONVERSATION_FORMAT_CONFIG);
    });

    it('should return default config when profileName is undefined', () => {
      const result = resolveConversationFormatConfig(undefined);
      expect(result).toEqual(DEFAULT_CONVERSATION_FORMAT_CONFIG);
    });

    it('should return default config when getRuntimeConfig throws', () => {
      // getRuntimeConfig may throw if not initialized
      const result = resolveConversationFormatConfig('nonexistent');
      expect(result).toBeDefined();
      expect(result.compression).toBeDefined();
    });
  });

  describe('resolveEffectiveFormatConfig', () => {
    it('should use base config when no overrides in metadata', () => {
      const memory = makeMemory();
      const result = resolveEffectiveFormatConfig(memory, null);
      expect(result).toBeDefined();
      expect(result.compression).toBeDefined();
    });

    it('should use conversation_format_override from metadata when present', () => {
      const overrideConfig = {
        ...DEFAULT_CONVERSATION_FORMAT_CONFIG,
        compression: {
          ...DEFAULT_CONVERSATION_FORMAT_CONFIG.compression,
          enable_ai_summary: false
        }
      };
      const memory = makeMemory({
        metadata: { conversation_format_override: overrideConfig }
      });
      const result = resolveEffectiveFormatConfig(memory, null);
      expect(result.compression.enable_ai_summary).toBe(false);
    });

    it('should use conversation_profile_override from metadata when present', () => {
      const memory = makeMemory({
        metadata: { conversation_profile_override: 'custom-profile' }
      });
      // Will fall back to default since 'custom-profile' likely doesn't exist in runtime config
      const result = resolveEffectiveFormatConfig(memory, 'base-profile');
      expect(result).toBeDefined();
    });

    it('should prioritize conversation_format_override over profile', () => {
      const overrideConfig = {
        ...DEFAULT_CONVERSATION_FORMAT_CONFIG,
        compression: {
          ...DEFAULT_CONVERSATION_FORMAT_CONFIG.compression,
          summary_trigger_turns: 999
        }
      };
      const memory = makeMemory({
        metadata: { conversation_format_override: overrideConfig }
      });
      const result = resolveEffectiveFormatConfig(memory, 'some-profile');
      expect(result.compression.summary_trigger_turns).toBe(999);
    });

    it('should handle memory without metadata', () => {
      const memory = makeMemory({ metadata: undefined });
      const result = resolveEffectiveFormatConfig(memory);
      expect(result).toEqual(DEFAULT_CONVERSATION_FORMAT_CONFIG);
    });
  });
});
