import fs from 'fs';
import { ZodError } from 'zod';

import { loadConfigYaml, readYamlFileIfExists } from '../config/loader.js';
import { deepMerge } from '../config/merge.js';
import { createLogger } from '../utils/logger.js';
import {
  aiRegistryConfigSchema,
  BUILTIN_AI_REGISTRY_CONFIG,
  promptSlotRegistrySchema,
  resetAiRegistryCache,
  resetPromptSlotRegistryCache,
} from './registry.js';

const logger = createLogger('ai-registry-watcher');

export interface AiRegistryWatcherOptions {
  aiModelsConfigPath: string;
  promptSlotsDefaultPath: string;
}

export interface AiRegistryWatcher {
  close(): void;
}

const DEBOUNCE_MS = 300;

const extractErrorMessage = (err: unknown): string => {
  if (err instanceof ZodError) {
    const issues = err.issues
      .slice(0, 3)
      .map(issue => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    const suffix = err.issues.length > 3 ? `\n  ... (+${String(err.issues.length - 3)} more issues)` : '';
    return `Zod 校验失败:\n${issues}${suffix}`;
  }

  if (err instanceof Error) {
    return err.message;
  }

  return String(err);
};

const formatSummary = (rawConfig: Record<string, unknown>, kind: 'ai_models' | 'prompt_slots'): string => {
  if (kind === 'ai_models') {
    const providers = Array.isArray(rawConfig.providers) ? rawConfig.providers.length : 0;
    const models = Array.isArray(rawConfig.models) ? rawConfig.models.length : 0;
    const routes = Array.isArray(rawConfig.routes) ? rawConfig.routes.length : 0;
    return `providers: ${String(providers)}, models: ${String(models)}, routes: ${String(routes)}`;
  }

  const slots = typeof rawConfig.slots === 'object' && rawConfig.slots !== null
    ? Object.keys(rawConfig.slots as Record<string, unknown>).length
    : 0;
  return `slots: ${String(slots)}`;
};

const resolveFileName = (filePath: string): string => {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? filePath;
};

const validateAndReloadAiModels = (filePath: string): void => {
  try {
    const rawConfig = readYamlFileIfExists(filePath);
    if (Object.keys(rawConfig).length === 0) {
      return;
    }

    const parsedOverride = loadConfigYaml({
      filePath,
      validate: raw => aiRegistryConfigSchema.parse({
        version: BUILTIN_AI_REGISTRY_CONFIG.version,
        ...raw
      })
    });

    resetAiRegistryCache();
    const summary = formatSummary(parsedOverride, 'ai_models');
    logger.info(`${resolveFileName(filePath)} 变更，重新加载成功\n  ${summary}`);
  } catch (err) {
    logger.warn(`${resolveFileName(filePath)} 校验失败，保留旧配置`, { error: extractErrorMessage(err) });
  }
};

const validateAndReloadPromptSlots = (filePath: string, defaultPath: string): void => {
  try {
    const rawOverride = readYamlFileIfExists(filePath);
    if (Object.keys(rawOverride).length === 0) {
      return;
    }

    const rawDefault = readYamlFileIfExists(defaultPath);
    const defaultParsed = promptSlotRegistrySchema.parse(rawDefault) as unknown as Record<string, unknown>;
    const merged = promptSlotRegistrySchema.parse(deepMerge(defaultParsed, rawOverride));

    // The parse above validates the merge. We don't use the result except for logging.
    void merged;

    resetPromptSlotRegistryCache();
    const summary = formatSummary(rawOverride, 'prompt_slots');
    logger.info(`${resolveFileName(filePath)} 变更，重新加载成功\n  ${summary}`);
  } catch (err) {
    logger.warn(`${resolveFileName(filePath)} 校验失败，保留旧配置`, { error: extractErrorMessage(err) });
  }
};

export const startAiRegistryWatcher = (options: AiRegistryWatcherOptions): AiRegistryWatcher => {
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const watchers: fs.FSWatcher[] = [];

  const scheduleReload = (filePath: string, handler: () => void): void => {
    const existing = debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    debounceTimers.set(
      filePath,
      setTimeout(() => {
        debounceTimers.delete(filePath);
        handler();
      }, DEBOUNCE_MS),
    );
  };

  const watchFile = (filePath: string, handler: () => void): void => {
    try {
      const watcher = fs.watch(filePath, (_eventType, _filename) => {
        scheduleReload(filePath, handler);
      });
      watchers.push(watcher);

      watcher.on('error', (err) => {
        logger.warn(`文件监听异常 ${resolveFileName(filePath)}`, { error: err instanceof Error ? err.message : String(err) });
      });
    } catch (err) {
      logger.warn(`无法监听文件 ${resolveFileName(filePath)}`, { error: err instanceof Error ? err.message : String(err) });
    }
  };

  const promptSlotsPath = options.aiModelsConfigPath.replace('ai_models.yaml', 'prompt_slots.yaml');

  watchFile(options.aiModelsConfigPath, () => {
    validateAndReloadAiModels(options.aiModelsConfigPath);
  });

  watchFile(promptSlotsPath, () => {
    validateAndReloadPromptSlots(promptSlotsPath, options.promptSlotsDefaultPath);
  });

  logger.info('热加载已启动', {
    ai_models: resolveFileName(options.aiModelsConfigPath),
    prompt_slots: resolveFileName(promptSlotsPath)
  });

  return {
    close() {
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();

      for (const watcher of watchers) {
        try {
          watcher.close();
        } catch {
          // ignore close errors
        }
      }
      watchers.length = 0;

      logger.info('热加载已停止');
    },
  };
};
