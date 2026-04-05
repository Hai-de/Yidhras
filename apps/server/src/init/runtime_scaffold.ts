import fs from 'fs';
import path from 'path';

import { resolveFromWorkspaceRoot, resolveWorkspaceRoot } from '../config/loader.js';

const CONFIG_DIR_RELATIVE_PATH = path.join('data', 'configw');
const VERSION_MANAGED_CONFIG_TEMPLATE_DIR_RELATIVE_PATH = path.join('apps', 'server', 'templates', 'configw');
const VERSION_MANAGED_WORLD_PACK_TEMPLATE_DIR_RELATIVE_PATH = path.join('apps', 'server', 'templates', 'world-pack');
const DEFAULT_CONFIG_BASENAME = 'default.yaml';
const DEVELOPMENT_CONFIG_BASENAME = 'development.yaml';
const PRODUCTION_CONFIG_BASENAME = 'production.yaml';
const TEST_CONFIG_BASENAME = 'test.yaml';
const DEFAULT_WORLD_PACK_TEMPLATE_BASENAME = 'death_note.yaml';

const SEEDED_CONFIG_BASENAMES = [
  DEFAULT_CONFIG_BASENAME,
  DEVELOPMENT_CONFIG_BASENAME,
  PRODUCTION_CONFIG_BASENAME,
  TEST_CONFIG_BASENAME
] as const;

export interface RuntimeConfigScaffoldResult {
  workspaceRoot: string;
  configDir: string;
  createdFiles: string[];
  existingFiles: string[];
}

const ensureFileFromTemplate = (
  targetFilePath: string,
  templateFilePath: string,
  result: RuntimeConfigScaffoldResult
): void => {
  if (fs.existsSync(targetFilePath)) {
    result.existingFiles.push(targetFilePath);
    return;
  }

  if (!fs.existsSync(templateFilePath)) {
    throw new Error(`[configw] 缺少版本管理模板文件: ${templateFilePath}`);
  }

  fs.mkdirSync(path.dirname(targetFilePath), { recursive: true });
  fs.copyFileSync(templateFilePath, targetFilePath);
  result.createdFiles.push(targetFilePath);
};

export const ensureRuntimeConfigScaffold = (
  workspaceRoot: string = resolveWorkspaceRoot()
): RuntimeConfigScaffoldResult => {
  const configDir = resolveFromWorkspaceRoot(CONFIG_DIR_RELATIVE_PATH, workspaceRoot);
  const configTemplateDir = resolveFromWorkspaceRoot(VERSION_MANAGED_CONFIG_TEMPLATE_DIR_RELATIVE_PATH, workspaceRoot);
  const worldPackTemplateDir = resolveFromWorkspaceRoot(VERSION_MANAGED_WORLD_PACK_TEMPLATE_DIR_RELATIVE_PATH, workspaceRoot);

  fs.mkdirSync(configDir, { recursive: true });

  const result: RuntimeConfigScaffoldResult = {
    workspaceRoot,
    configDir,
    createdFiles: [],
    existingFiles: []
  };

  for (const basename of SEEDED_CONFIG_BASENAMES) {
    ensureFileFromTemplate(path.join(configDir, basename), path.join(configTemplateDir, basename), result);
  }

  ensureFileFromTemplate(
    path.join(configDir, 'templates', 'world-pack', DEFAULT_WORLD_PACK_TEMPLATE_BASENAME),
    path.join(worldPackTemplateDir, DEFAULT_WORLD_PACK_TEMPLATE_BASENAME),
    result
  );

  return result;
};

export const logRuntimeConfigScaffoldResult = (
  result: RuntimeConfigScaffoldResult,
  logger: (message: string) => void = console.log
): void => {
  logger(
    `[init:configw] config_dir=${result.configDir} | created=${result.createdFiles.length} | existing=${result.existingFiles.length}`
  );
};
