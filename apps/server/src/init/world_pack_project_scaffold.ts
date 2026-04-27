import fs from 'fs';
import path from 'path';
import * as YAML from 'yaml';

import { resolveFromWorkspaceRoot, resolveWorkspaceRoot } from '../config/loader.js';
import { getWorldPacksDir } from '../config/runtime_config.js';
import { parseWorldPackConstitution } from '../packs/manifest/constitution_loader.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('world-pack-scaffold');

const TEMPLATE_DIR_RELATIVE_PATH = path.join('apps', 'server', 'templates', 'world-pack');
const DEFAULT_CONFIG_TEMPLATE_BASENAME = 'pack.yaml.template';
const DEFAULT_README_TEMPLATE_BASENAME = 'pack.README.template.md';
const DEFAULT_CHANGELOG_TEMPLATE_BASENAME = 'pack.CHANGELOG.template.md';
const DEFAULT_LICENSE_TEMPLATE_BASENAME = 'pack.LICENSE.template';
const DEFAULT_DOCS_SETTING_TEMPLATE_BASENAME = 'pack.docs.setting.template.md';
const DEFAULT_EXAMPLES_OVERRIDES_TEMPLATE_BASENAME = 'pack.examples.overrides.template.yaml';

const DEFAULT_CONFIGW_BASENAME = 'default.yaml';

export interface WorldPackProjectScaffoldOptions {
  packDirName: string;
  packId?: string;
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  tags?: string[];
  status?: string;
  yidhrasCompatibility?: string;
  overwrite?: boolean;
  setPreferredPack?: boolean;
  setBootstrapTemplate?: boolean;
  disableBootstrap?: boolean;
  dryRun?: boolean;
  workspaceRoot?: string;
}

export interface WorldPackProjectScaffoldResult {
  workspaceRoot: string;
  templateDir: string;
  targetPackDir: string;
  createdFiles: string[];
  overwrittenFiles: string[];
  skippedFiles: string[];
  values: Record<string, string>;
  dryRun: boolean;
  plannedFiles: string[];
  configUpdates: string[];
}

export interface WorldPackScaffoldValidationResult {
  packId: string;
}

const normalizePackId = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-');
};

const normalizePackDirName = (value: string): string => {
  return value
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('-')
    .replace(/[^a-zA-Z0-9-_]+/g, '_');
};

const toTitleCase = (value: string): string => {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const renderTemplate = (template: string, values: Record<string, string>): string => {
  let rendered = template;
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.replace(new RegExp(`{{${escapeRegExp(key)}}}`, 'g'), value);
  }
  return rendered;
};

const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toInlineYamlArray = (values: string[]): string => {
  if (values.length === 0) {
    return '[]';
  }
  return `[${values.map(value => `"${value}"`).join(', ')}]`;
};

const toAuthorsYaml = (values: string[]): string => {
  if (values.length === 0) {
    return '    - name: "Unknown Author"';
  }

  return values
    .map(value => `    - name: "${value}"\n      role: "pack author"`)
    .join('\n');
};

const writeRenderedTemplate = (input: {
  templatePath: string;
  targetPath: string;
  values: Record<string, string>;
  overwrite: boolean;
  result: WorldPackProjectScaffoldResult;
  dryRun: boolean;
}): void => {
  const { templatePath, targetPath, values, overwrite, result, dryRun } = input;
  if (!fs.existsSync(templatePath)) {
    throw new Error(`[world-pack-scaffold] 模板文件不存在: ${templatePath}`);
  }

  const existed = fs.existsSync(targetPath);
  if (existed && !overwrite) {
    result.skippedFiles.push(targetPath);
    return;
  }

  if (dryRun) {
    result.plannedFiles.push(targetPath);
    return;
  }

  const template = fs.readFileSync(templatePath, 'utf-8');
  const rendered = renderTemplate(template, values);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, rendered, 'utf-8');

  if (existed) {
    result.overwrittenFiles.push(targetPath);
  } else {
    result.createdFiles.push(targetPath);
  }
};

const updateDefaultRuntimeConfig = (input: {
  workspaceRoot: string;
  packDirName: string;
  setPreferredPack: boolean;
  setBootstrapTemplate: boolean;
  disableBootstrap: boolean;
  dryRun: boolean;
}): string[] => {
  const updates: string[] = [];
  if (!input.setPreferredPack && !input.setBootstrapTemplate && !input.disableBootstrap) {
    return updates;
  }

  const defaultConfigPath = resolveFromWorkspaceRoot(path.join('data', 'configw', DEFAULT_CONFIGW_BASENAME), input.workspaceRoot);
  if (!fs.existsSync(defaultConfigPath)) {
    return updates;
  }

  const raw = fs.readFileSync(defaultConfigPath, 'utf-8');
  const parsed = (YAML.parse(raw) ?? {}) as Record<string, unknown>;
  const world = (parsed.world && typeof parsed.world === 'object' ? parsed.world : {}) as Record<string, unknown>;
  const bootstrap = (world.bootstrap && typeof world.bootstrap === 'object' ? world.bootstrap : {}) as Record<string, unknown>;

  if (input.setPreferredPack) {
    world.preferred_pack = input.packDirName;
    updates.push(`set world.preferred_pack=${input.packDirName}`);
  }

  if (input.setBootstrapTemplate) {
    bootstrap.target_pack_dir = input.packDirName;
    bootstrap.template_file = `data/world_packs/${input.packDirName}/config.yaml`;
    updates.push(`set world.bootstrap.target_pack_dir=${input.packDirName}`);
    updates.push(`set world.bootstrap.template_file=data/world_packs/${input.packDirName}/config.yaml`);
  }

  if (input.disableBootstrap) {
    bootstrap.enabled = false;
    updates.push('set world.bootstrap.enabled=false');
  }

  if (input.dryRun) {
    return updates;
  }

  world.bootstrap = bootstrap;
  parsed.world = world;
  fs.writeFileSync(defaultConfigPath, YAML.stringify(parsed), 'utf-8');

  return updates;
};

export const scaffoldWorldPackProject = (
  options: WorldPackProjectScaffoldOptions
): WorldPackProjectScaffoldResult => {
  const workspaceRoot = options.workspaceRoot ?? resolveWorkspaceRoot();
  const templateDir = resolveFromWorkspaceRoot(TEMPLATE_DIR_RELATIVE_PATH, workspaceRoot);
  const normalizedPackDirName = normalizePackDirName(options.packDirName);

  if (!normalizedPackDirName) {
    throw new Error('[world-pack-scaffold] packDirName 不能为空');
  }

  const packId = normalizePackId(options.packId ?? normalizedPackDirName);
  if (!packId) {
    throw new Error('[world-pack-scaffold] 无法从输入生成合法 pack id');
  }

  const packName = (options.name?.trim() || toTitleCase(normalizedPackDirName));
  const packVersion = options.version?.trim() || '0.1.0';
  const packDescription = options.description?.trim() || `A new Yidhras world pack named ${packName}.`;
  const authorNames = (options.author?.split(',').map(item => item.trim()).filter(Boolean) ?? []);
  const license = options.license?.trim() || 'UNLICENSED';
  const homepage = options.homepage?.trim() || 'https://example.com/world-pack';
  const repository = options.repository?.trim() || 'https://example.com/repository/world-pack';
  const status = options.status?.trim() || 'draft';
  const tags = (options.tags?.map(item => item.trim()).filter(Boolean) ?? []).length > 0
    ? options.tags!.map(item => item.trim()).filter(Boolean)
    : ['custom-pack'];
  const yidhrasCompatibility = options.yidhrasCompatibility?.trim() || '>=0.5.0';
  const publishedAt = formatDate(new Date());
  const targetPackDir = path.join(getWorldPacksDir(), normalizedPackDirName);

  const values: Record<string, string> = {
    PACK_ID: packId,
    PACK_DIR: normalizedPackDirName,
    PACK_NAME: packName,
    PACK_VERSION: packVersion,
    PACK_DESCRIPTION: packDescription,
    PACK_AUTHORS: authorNames.length > 0 ? authorNames.join(', ') : 'Unknown Author',
    PACK_AUTHORS_YAML: toAuthorsYaml(authorNames),
    PACK_LICENSE: license,
    PACK_HOMEPAGE: homepage,
    PACK_REPOSITORY: repository,
    PACK_TAGS: tags.join(', '),
    PACK_TAGS_INLINE_YAML: toInlineYamlArray(tags),
    PACK_STATUS: status,
    PACK_PUBLISHED_AT: publishedAt,
    PACK_GENRE: 'custom',
    YIDHRAS_COMPATIBILITY: yidhrasCompatibility,
    PACK_COMPATIBILITY_NOTES: 'Generated by scaffoldWorldPackProject.',
    PACK_PUBLISHED_NOTE: 'Generated scaffold',
    PACK_STATUS_LABEL: status
  };

  const result: WorldPackProjectScaffoldResult = {
    workspaceRoot,
    templateDir,
    targetPackDir,
    createdFiles: [],
    overwrittenFiles: [],
    skippedFiles: [],
    values,
    dryRun: options.dryRun === true,
    plannedFiles: [],
    configUpdates: []
  };

  if (!result.dryRun) {
    fs.mkdirSync(targetPackDir, { recursive: true });
  }

  writeRenderedTemplate({
    templatePath: path.join(templateDir, DEFAULT_CONFIG_TEMPLATE_BASENAME),
    targetPath: path.join(targetPackDir, 'config.yaml'),
    values,
    overwrite: options.overwrite === true,
    result,
    dryRun: result.dryRun
  });

  writeRenderedTemplate({
    templatePath: path.join(templateDir, DEFAULT_README_TEMPLATE_BASENAME),
    targetPath: path.join(targetPackDir, 'README.md'),
    values,
    overwrite: options.overwrite === true,
    result,
    dryRun: result.dryRun
  });

  writeRenderedTemplate({
    templatePath: path.join(templateDir, DEFAULT_CHANGELOG_TEMPLATE_BASENAME),
    targetPath: path.join(targetPackDir, 'CHANGELOG.md'),
    values,
    overwrite: options.overwrite === true,
    result,
    dryRun: result.dryRun
  });

  if (!result.dryRun) {
    fs.mkdirSync(path.join(targetPackDir, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(targetPackDir, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(targetPackDir, 'examples'), { recursive: true });
  }

  writeRenderedTemplate({
    templatePath: path.join(templateDir, DEFAULT_LICENSE_TEMPLATE_BASENAME),
    targetPath: path.join(targetPackDir, 'LICENSE'),
    values,
    overwrite: options.overwrite === true,
    result,
    dryRun: result.dryRun
  });

  writeRenderedTemplate({
    templatePath: path.join(templateDir, DEFAULT_DOCS_SETTING_TEMPLATE_BASENAME),
    targetPath: path.join(targetPackDir, 'docs', 'setting.md'),
    values,
    overwrite: options.overwrite === true,
    result,
    dryRun: result.dryRun
  });

  writeRenderedTemplate({
    templatePath: path.join(templateDir, DEFAULT_EXAMPLES_OVERRIDES_TEMPLATE_BASENAME),
    targetPath: path.join(targetPackDir, 'examples', 'overrides.example.yaml'),
    values,
    overwrite: options.overwrite === true,
    result,
    dryRun: result.dryRun
  });

  result.configUpdates = updateDefaultRuntimeConfig({
    workspaceRoot,
    packDirName: normalizedPackDirName,
    setPreferredPack: options.setPreferredPack === true,
    setBootstrapTemplate: options.setBootstrapTemplate === true,
    disableBootstrap: options.disableBootstrap === true,
    dryRun: result.dryRun
  });

  const configTemplatePath = path.join(templateDir, DEFAULT_CONFIG_TEMPLATE_BASENAME);
  if (!fs.existsSync(configTemplatePath)) {
    throw new Error(`[world-pack-scaffold] 模板文件不存在: ${configTemplatePath}`);
  }
  const renderedConfig = renderTemplate(fs.readFileSync(configTemplatePath, 'utf-8'), values);
  const generatedPack = YAML.parse(renderedConfig);
  parseWorldPackConstitution(generatedPack, `${targetPackDir}/config.yaml`);

  return result;
};

export const logWorldPackProjectScaffoldResult = (
  result: WorldPackProjectScaffoldResult,
  logger: (message: string) => void = log.info
): void => {
  const mode = result.dryRun ? 'dry-run' : 'write';
  logger(
    `[world-pack-scaffold] mode=${mode} | target=${result.targetPackDir} | created=${result.createdFiles.length} | overwritten=${result.overwrittenFiles.length} | skipped=${result.skippedFiles.length} | planned=${result.plannedFiles.length}`
  );
  if (result.configUpdates.length > 0) {
    logger(`[world-pack-scaffold] config-updates=${result.configUpdates.join(' ; ')}`);
  }
};
