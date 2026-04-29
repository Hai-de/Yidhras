import path from 'path';

import { resolveFromWorkspaceRoot, resolveWorkspaceRoot } from '../config/loader.js';
import { createLogger } from '../utils/logger.js';
import { safeFs } from '../utils/safe_fs.js';

const log = createLogger('runtime-scaffold');

const CONFIG_DIR_RELATIVE_PATH = path.join('data', 'configw');
const CONFIG_FRAGMENTS_DIRNAME = 'conf.d';
const VERSION_MANAGED_CONFIG_TEMPLATE_DIR_RELATIVE_PATH = path.join('apps', 'server', 'templates', 'configw');
const VERSION_MANAGED_WORLD_PACK_TEMPLATE_DIR_RELATIVE_PATH = path.join('apps', 'server', 'templates', 'world-pack');
const DEFAULT_CONFIG_BASENAME = 'default.yaml';
const DEVELOPMENT_CONFIG_BASENAME = 'development.yaml';
const PRODUCTION_CONFIG_BASENAME = 'production.yaml';
const TEST_CONFIG_BASENAME = 'test.yaml';
const DEFAULT_WORLD_PACK_TEMPLATE_BASENAME = 'example_pack.yaml';
const DEFAULT_WORLD_PACK_README_TEMPLATE_BASENAME = 'example_pack.README.md';
const DEFAULT_WORLD_PACK_CHANGELOG_TEMPLATE_BASENAME = 'example_pack.CHANGELOG.md';
const DEFAULT_AI_MODELS_CONFIG_BASENAME = 'ai_models.yaml';
const VERSION_MANAGED_AI_CONFIG_RELATIVE_PATH = path.join('apps', 'server', 'config', DEFAULT_AI_MODELS_CONFIG_BASENAME);

const SEEDED_CONFIG_BASENAMES = [
  DEFAULT_CONFIG_BASENAME,
  DEVELOPMENT_CONFIG_BASENAME,
  PRODUCTION_CONFIG_BASENAME,
  TEST_CONFIG_BASENAME
] as const;

const SEEDED_WORLD_PACK_TEMPLATE_BASENAMES = [
  DEFAULT_WORLD_PACK_TEMPLATE_BASENAME,
  DEFAULT_WORLD_PACK_README_TEMPLATE_BASENAME,
  DEFAULT_WORLD_PACK_CHANGELOG_TEMPLATE_BASENAME
] as const;

export interface RuntimeConfigScaffoldResult {
  workspaceRoot: string;
  configDir: string;
  createdFiles: string[];
  existingFiles: string[];
}

const ensureFileFromTemplate = (
  workspaceRoot: string,
  targetFilePath: string,
  templateFilePath: string,
  result: RuntimeConfigScaffoldResult
): void => {
  if (safeFs.existsSync(workspaceRoot, targetFilePath)) {
    result.existingFiles.push(targetFilePath);
    return;
  }

  if (!safeFs.existsSync(workspaceRoot, templateFilePath)) {
    throw new Error(`[configw] 缺少版本管理模板文件: ${templateFilePath}`);
  }

  safeFs.mkdirSync(workspaceRoot, path.dirname(targetFilePath), { recursive: true });
  safeFs.copyFileSync(workspaceRoot, templateFilePath, targetFilePath);
  result.createdFiles.push(targetFilePath);
};

export const ensureRuntimeConfigScaffold = (
  workspaceRoot: string = resolveWorkspaceRoot()
): RuntimeConfigScaffoldResult => {
  const configDir = resolveFromWorkspaceRoot(CONFIG_DIR_RELATIVE_PATH, workspaceRoot);
  const configTemplateDir = resolveFromWorkspaceRoot(VERSION_MANAGED_CONFIG_TEMPLATE_DIR_RELATIVE_PATH, workspaceRoot);
  const worldPackTemplateDir = resolveFromWorkspaceRoot(VERSION_MANAGED_WORLD_PACK_TEMPLATE_DIR_RELATIVE_PATH, workspaceRoot);
  const aiModelsConfigTemplatePath = resolveFromWorkspaceRoot(VERSION_MANAGED_AI_CONFIG_RELATIVE_PATH, workspaceRoot);

  safeFs.mkdirSync(workspaceRoot, configDir, { recursive: true });

  const result: RuntimeConfigScaffoldResult = {
    workspaceRoot,
    configDir,
    createdFiles: [],
    existingFiles: []
  };

  for (const basename of SEEDED_CONFIG_BASENAMES) {
    ensureFileFromTemplate(workspaceRoot, path.join(configDir, basename), path.join(configTemplateDir, basename), result);
  }

  // Seed conf.d/ fragments (new split-config layout)
  const fragmentsTemplateDir = path.join(configTemplateDir, CONFIG_FRAGMENTS_DIRNAME);
  const fragmentsTargetDir = path.join(configDir, CONFIG_FRAGMENTS_DIRNAME);

  if (safeFs.existsSync(workspaceRoot, fragmentsTemplateDir)) {
    safeFs.mkdirSync(workspaceRoot, fragmentsTargetDir, { recursive: true });

    const fragmentFiles = safeFs
      .readdirSync(workspaceRoot, fragmentsTemplateDir)
      .filter(name => name.endsWith('.yaml') || name.endsWith('.yml'));

    for (const basename of fragmentFiles) {
      ensureFileFromTemplate(workspaceRoot,
        path.join(fragmentsTargetDir, basename),
        path.join(fragmentsTemplateDir, basename),
        result
      );
    }
  }

  for (const basename of SEEDED_WORLD_PACK_TEMPLATE_BASENAMES) {
    ensureFileFromTemplate(workspaceRoot, path.join(configDir, 'templates', 'world-pack', basename), path.join(worldPackTemplateDir, basename), result);
  }

  ensureFileFromTemplate(workspaceRoot,
    resolveFromWorkspaceRoot(path.join('apps', 'server', 'config', DEFAULT_AI_MODELS_CONFIG_BASENAME), workspaceRoot),
    aiModelsConfigTemplatePath,
    result
  );

  return result;
};

export const logRuntimeConfigScaffoldResult = (
  result: RuntimeConfigScaffoldResult,
  logger: (message: string) => void = (...args) => log.info(...args)
): void => {
  logger(
    `[init:configw] config_dir=${result.configDir} | created=${result.createdFiles.length} | existing=${result.existingFiles.length}`
  );
};
