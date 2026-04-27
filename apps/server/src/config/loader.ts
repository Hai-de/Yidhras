import fs from 'fs';
import path from 'path';
import * as YAML from 'yaml';

const WORKSPACE_ROOT_MARKERS = ['pnpm-workspace.yaml', '.git'];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const resolveWorkspaceRoot = (startDir: string = process.cwd()): string => {
  const explicitWorkspaceRoot = process.env.WORKSPACE_ROOT?.trim();
  if (explicitWorkspaceRoot) {
    return path.resolve(explicitWorkspaceRoot);
  }

  const initial = path.resolve(startDir);
  let current: string | null = initial;

  while (current !== null) {
    const currentDir = current;
    const hasMarker = WORKSPACE_ROOT_MARKERS.some(marker => fs.existsSync(path.join(currentDir, marker)));
    if (hasMarker) {
      return currentDir;
    }

    const parent = path.dirname(current);
    current = parent === current ? null : parent;
  }

  return initial;
};

export const resolveFromWorkspaceRoot = (
  relativePath: string,
  workspaceRoot: string = resolveWorkspaceRoot()
): string => {
  return path.isAbsolute(relativePath) ? relativePath : path.resolve(workspaceRoot, relativePath);
};

export const readYamlFileIfExists = (filePath: string): Record<string, unknown> => {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  if (content.trim().length === 0) {
    return {};
  }

  const parsed = YAML.parse(content) as unknown;
  if (parsed === undefined || parsed === null) {
    return {};
  }

  if (!isRecord(parsed)) {
    throw new Error(`[runtime_config] YAML 配置必须是对象: ${filePath}`);
  }

  return parsed;
};

/**
 * 统一的 YAML 配置加载器。
 *
 * 封装 readYamlFileIfExists + validate 的标准流程，
 * 供 runtime_config / ai/registry / inference/context_config 使用。
 * 合并逻辑由调用方通过 defaults 参数控制，保留各域特定的 deepMerge 策略。
 */
export const loadConfigYaml = <T>(options: {
  filePath: string;
  validate: (raw: Record<string, unknown>) => T;
}): T => {
  const raw = readYamlFileIfExists(options.filePath);
  return options.validate(raw);
};
