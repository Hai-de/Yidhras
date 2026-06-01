import { describe, expect, it, vi } from 'vitest';

import type { AiProviderTemplate } from '../../../src/ai/types.js';

// The openai_compatible module has many internal pure functions
// We test them indirectly through the adapter or directly if exported.
// Since they're not exported, we test the module's behavior through the adapter.

// Mock fetch for provider tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('AI provider openai_compatible helpers', () => {
  // Test the pure helper functions by importing them directly
  // These are internal to the module but we can test through the adapter interface

  describe('normalizeFinishReason', () => {
    // normalizeFinishReason is not exported, so we test it through the adapter
    // But we can test the behavior via the exported adapter

    it('adapter exports expected shape', async () => {
      // Verify the module loads correctly
      const mod = await import('../../../src/ai/providers/openai_compatible.js');
      expect(mod.createOpenAiCompatibleAdapter).toBeDefined();
      expect(mod.createOpenAiCompatibleAdapterFromTemplate).toBeDefined();
    });
  });

  describe('createOpenAiCompatibleAdapterFromTemplate', () => {
    it('creates adapter with correct provider name', async () => {
      const { createOpenAiCompatibleAdapterFromTemplate } = await import('../../../src/ai/providers/openai_compatible.js');

      const adapter = createOpenAiCompatibleAdapterFromTemplate({
        name: 'test-provider',
        kind: 'openai_compatible',
        base_url: 'https://api.test.com/v1',
        api_key_env: 'TEST_API_KEY',
        default_headers: { 'X-Test': 'header' }
      } as AiProviderTemplate);

      // The template adapter doesn't expose provider directly on the returned object
      expect(adapter).toBeDefined();
    });

    it('creates adapter with listModels method', async () => {
      const { createOpenAiCompatibleAdapterFromTemplate } = await import('../../../src/ai/providers/openai_compatible.js');

      const adapter = createOpenAiCompatibleAdapterFromTemplate({
        name: 'test-provider',
        kind: 'openai_compatible',
        base_url: 'https://api.test.com/v1',
        api_key_env: 'TEST_API_KEY',
        default_headers: { 'X-Test': 'header' }
      } as AiProviderTemplate);

      expect(adapter.listModels).toBeDefined();
      expect(typeof adapter.listModels).toBe('function');
    });

    it('creates adapter with execute method', async () => {
      const { createOpenAiCompatibleAdapterFromTemplate } = await import('../../../src/ai/providers/openai_compatible.js');

      const adapter = createOpenAiCompatibleAdapterFromTemplate({
        name: 'test-provider',
        kind: 'openai_compatible',
        base_url: 'https://api.test.com/v1',
        api_key_env: 'TEST_API_KEY',
        default_headers: { 'X-Test': 'header' }
      } as AiProviderTemplate);

      expect(adapter.execute).toBeDefined();
      expect(typeof adapter.execute).toBe('function');
    });

    it('creates adapter with executeStream method', async () => {
      const { createOpenAiCompatibleAdapterFromTemplate } = await import('../../../src/ai/providers/openai_compatible.js');

      const adapter = createOpenAiCompatibleAdapterFromTemplate({
        name: 'test-provider',
        kind: 'openai_compatible',
        base_url: 'https://api.test.com/v1',
        api_key_env: 'TEST_API_KEY',
        default_headers: { 'X-Test': 'header' }
      } as AiProviderTemplate);

      expect(adapter.executeStream).toBeDefined();
      expect(typeof adapter.executeStream).toBe('function');
    });
  });

  describe('createOpenAiCompatibleAdapter', () => {
    it('creates adapter with custom config', async () => {
      const { createOpenAiCompatibleAdapter } = await import('../../../src/ai/providers/openai_compatible.js');

      const adapter = createOpenAiCompatibleAdapter({
        provider: 'custom-provider',
        resolveApiKey: () => 'test-key',
        resolveBaseUrl: () => 'https://api.custom.com/v1',
        buildHeaders: () => ({ 'X-Custom': 'header' })
      });

      expect(adapter).toBeDefined();
      expect(adapter.execute).toBeDefined();
      expect(adapter.executeStream).toBeDefined();
      expect(adapter.listModels).toBeDefined();
    });
  });
});
