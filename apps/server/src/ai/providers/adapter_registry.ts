import { createLogger } from '../../utils/logger.js';
import type { AiProviderTemplate, AiRegistryConfig } from '../types.js';
import { createAnthropicProviderAdapter } from './anthropic.js';
import { createDeepSeekProviderAdapter } from './deepseek.js';
import { createMockAiProviderAdapter } from './mock.js';
import { createOllamaProviderAdapter } from './ollama.js';
import { createOpenAiProviderAdapter } from './openai.js';
import { createOpenAiCompatibleAdapterFromTemplate } from './openai_compatible.js';
import type { AiProviderAdapter } from './types.js';

const logger = createLogger('adapter-registry');

export type BuiltinAdapterFactory = () => AiProviderAdapter;

const builtinFactories = new Map<string, BuiltinAdapterFactory>([
  ['mock', createMockAiProviderAdapter],
  ['openai', createOpenAiProviderAdapter],
  ['anthropic', createAnthropicProviderAdapter],
  ['deepseek', createDeepSeekProviderAdapter],
  ['ollama', createOllamaProviderAdapter],
]);

export const listBuiltinAdapterNames = (): string[] => Array.from(builtinFactories.keys());

/** 从 registry config 动态构建 adapter 列表 */
export const buildAdaptersFromRegistry = (registryConfig: AiRegistryConfig): AiProviderAdapter[] => {
  const adapters = new Map<string, AiProviderAdapter>();

  // 1. 加载所有内置 adapter（默认启用）
  for (const [name, factory] of builtinFactories) {
    adapters.set(name, factory());
  }

  // 2. 根据 provider_templates 动态构建/覆盖
  for (const template of registryConfig.provider_templates ?? []) {
    if (template.kind === 'openai_compatible') {
      adapters.set(template.name, createOpenAiCompatibleAdapterFromTemplate(template));
    } else if (template.kind === 'builtin' && template.builtin_name) {
      const factory = builtinFactories.get(template.builtin_name);
      if (factory) {
        const builtin = factory();
        // 如果 template name 与内置 name 不同，使用 template name 作为 provider 标识
        if (template.name !== template.builtin_name) {
          adapters.set(template.name, {
            ...builtin,
            provider: template.name
          });
        } else {
          adapters.set(template.name, builtin);
        }
      } else {
        logger.warn(`Unknown builtin adapter: ${template.builtin_name}`);
      }
    }
  }

  return Array.from(adapters.values());
};
