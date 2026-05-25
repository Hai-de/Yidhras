import { existsSync, readdirSync,readFileSync } from 'node:fs';
import path from 'node:path';

import { pluginManifestSchema } from '@yidhras/contracts';
import * as YAML from 'yaml';

import { resolveWorkspaceRoot } from '../config/loader.js';
import { btTreeMapSchema } from '../inference/providers/behavior_tree/schema.js';
import { TreeRegistry } from '../inference/providers/behavior_tree/tree_registry.js';
import { resolveIncludes } from '../packs/manifest/include_resolver.js';
import { parseWorldPackConstitution } from '../packs/schema/constitution_schema.js';

const workspaceRoot = resolveWorkspaceRoot();
const defaultPacksDir = path.join(workspaceRoot, 'data', 'world_packs');

interface ValidationIssue {
  severity: 'PASS' | 'WARN' | 'FAIL';
  message: string;
}

interface PackValidationResult {
  packDir: string;
  issues: ValidationIssue[];
}

const printHelp = (): void => {
  console.log(`validate:pack — 世界包结构与配置校验

用法:
  pnpm validate:pack <pack-dir>      校验指定 pack 目录
  pnpm validate:pack --all            校验 data/world_packs/ 下所有 pack
  pnpm validate:pack --help           显示此帮助
`);
};

interface ParsedArgs {
  help?: boolean;
  all?: boolean;
  packDir?: string;
}

const parseArgs = (argv: string[]): ParsedArgs => {
  const parsed: ParsedArgs = {};

  for (const arg of argv) {
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--all':
        parsed.all = true;
        break;
      default:
        if (!arg.startsWith('-') && !parsed.packDir) {
          parsed.packDir = arg;
        }
    }
  }

  return parsed;
};

const fileExists = (base: string, file: string): boolean => {
  return existsSync(path.join(base, file));
};

const readYaml = (filePath: string): unknown => {
  const content = readFileSync(filePath, 'utf-8');
  return YAML.parse(content);
};

const validateIncludes = (parsed: unknown, packDir: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return issues;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- CLI output serialization
  const obj = parsed as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- CLI output serialization
  const include = obj.include as Record<string, unknown> | undefined;
  if (!include || typeof include !== 'object' || Object.keys(include).length === 0) {
    return issues;
  }

  const includeEntries = Object.entries(include);
  issues.push({
    severity: 'PASS',
    message: `include 指令: ${includeEntries.length} 个文件引用`
  });

  const validKeys = new Set([
    'schema_version', 'metadata', 'constitution', 'variables', 'prompts',
    'ai', 'time_systems', 'simulation_time', 'entities', 'identities',
    'capabilities', 'authorities', 'rules', 'storage', 'scheduler',
    'bootstrap', 'state_transforms', 'spatial',
    'behavior_trees', 'dynamics_config'
  ]);

  for (const [sectionKey, includeValue] of includeEntries) {
    if (!validKeys.has(sectionKey)) {
      issues.push({
        severity: 'WARN',
        message: `include: 未知 section key "${sectionKey}"`
      });
    }

    const filePath = typeof includeValue === 'string'
      ? includeValue
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- CLI output serialization
      : (includeValue as Record<string, unknown>)?.file as string | undefined;

    if (!filePath || typeof filePath !== 'string') {
      issues.push({
        severity: 'FAIL',
        message: `include.${sectionKey}: 文件路径无效或缺失`
      });
      continue;
    }

    const absolutePath = path.resolve(packDir, filePath);
    if (!existsSync(absolutePath)) {
      issues.push({
        severity: 'FAIL',
        message: `include.${sectionKey}: 文件不存在 "${filePath}"`
      });
      continue;
    }

    try {
      const subContent: unknown = YAML.parse(readFileSync(absolutePath, 'utf-8'));
      const hasSubContent = subContent !== null && subContent !== undefined;

      if (!hasSubContent) {
        issues.push({
          severity: 'WARN',
          message: `include.${sectionKey}: "${filePath}" 解析结果为空`
        });
      } else {
        issues.push({
          severity: 'PASS',
          message: `include.${sectionKey}: "${filePath}" 解析成功`
        });
      }
    } catch (error) {
      issues.push({
        severity: 'FAIL',
        message: `include.${sectionKey}: "${filePath}" YAML 解析失败: ${error instanceof Error ? error.message : String(error)}`
      });
    }

    if (sectionKey in obj && sectionKey !== 'include') {
      issues.push({
        severity: 'WARN',
        message: `include.${sectionKey}: 入口文件内联定义了 "${sectionKey}"，include 值将覆盖`
      });
    }
  }

  return issues;
};

const validateConfig = (packDir: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const configFiles = ['pack.yaml', 'pack.yml'];
  const found = configFiles.find((f) => fileExists(packDir, f));

  if (!found) {
    issues.push({ severity: 'FAIL', message: `缺少配置文件 (未找到: ${configFiles.join(', ')})` });
    return issues;
  }

  const configPath = path.join(packDir, found);
  issues.push({ severity: 'PASS', message: `配置文件: ${found}` });

  let parsed: unknown;
  try {
    parsed = readYaml(configPath);
    issues.push({ severity: 'PASS', message: 'YAML 解析成功' });
  } catch (error) {
    issues.push({
      severity: 'FAIL',
      message: `YAML 解析失败: ${error instanceof Error ? error.message : String(error)}`
    });
    return issues;
  }

  const includeIssues = validateIncludes(parsed, packDir);
  issues.push(...includeIssues);
  const hasIncludeFail = includeIssues.some((i) => i.severity === 'FAIL');

  let mergedParsed = parsed;
  if (!hasIncludeFail && typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- CLI output serialization
    const obj = parsed as Record<string, unknown>;
    if (obj.include && typeof obj.include === 'object' && Object.keys(obj.include).length > 0) {
      const { merged, diagnostics } = resolveIncludes(obj, packDir);
      const mergeErrors = diagnostics.filter((d) => d.severity === 'ERROR');
      if (mergeErrors.length > 0) {
        for (const d of mergeErrors) {
          issues.push({
            severity: 'FAIL',
            message: `include 解析: ${d.section ? `[${d.section}] ` : ''}${d.message}`
          });
        }
        return issues;
      }
      mergedParsed = merged;
    }
  }

  try {
    const result = parseWorldPackConstitution(mergedParsed, path.basename(packDir));
    issues.push({ severity: 'PASS', message: `Schema 校验通过 (id: ${result.metadata.id}, version: ${result.metadata.version})` });
  } catch (error) {
    issues.push({
      severity: 'FAIL',
      message: `Schema 校验失败: ${error instanceof Error ? error.message : String(error)}`
    });
  }

  // Behavior tree validation (if defined)
  if (typeof mergedParsed === 'object' && mergedParsed !== null && !Array.isArray(mergedParsed)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- CLI output serialization
    const treeIssues = validateBehaviorTrees(mergedParsed as Record<string, unknown>);
    issues.push(...treeIssues);
  }

  return issues;
};

const validateReadme = (packDir: string): ValidationIssue[] => {
  if (fileExists(packDir, 'README.md')) {
    return [{ severity: 'PASS', message: 'README.md 存在' }];
  }
  return [{ severity: 'WARN', message: '缺少 README.md (建议添加)' }];
};

const validatePlugins = (packDir: string): ValidationIssue[] => {
  const pluginsDir = path.join(packDir, 'plugins');
  if (!existsSync(pluginsDir)) {
    return [];
  }

  const issues: ValidationIssue[] = [];
  let entries: string[];

  try {
    entries = readdirSync(pluginsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    issues.push({ severity: 'FAIL', message: `无法读取 plugins 目录: ${pluginsDir}` });
    return issues;
  }

  if (entries.length === 0) {
    return [{ severity: 'WARN', message: 'plugins 目录为空' }];
  }

  for (const pluginDir of entries) {
    const manifestPath = path.join(pluginsDir, pluginDir, 'plugin.manifest.yaml');
    if (!existsSync(manifestPath)) {
      issues.push({
        severity: 'FAIL',
        message: `插件 "${pluginDir}" 缺少 plugin.manifest.yaml`
      });
      continue;
    }

    try {
      const manifest = readYaml(manifestPath);
      const result = pluginManifestSchema.safeParse(manifest);
      if (result.success) {
        issues.push({
          severity: 'PASS',
          message: `插件 "${pluginDir}" manifest 校验通过 (v${result.data.version})`
        });
      } else {
        const messages = result.error.issues
          .map((i) => `  ${i.path.join('.')}: ${i.message}`)
          .join('\n');
        issues.push({
          severity: 'FAIL',
          message: `插件 "${pluginDir}" manifest 校验失败:\n${messages}`
        });
      }
    } catch (error) {
      issues.push({
        severity: 'FAIL',
        message: `插件 "${pluginDir}" YAML 解析失败: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  return issues;
};

const validateBehaviorTrees = (parsedConfig: Record<string, unknown>): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const rawTrees = parsedConfig.behavior_trees;

  if (!rawTrees || typeof rawTrees !== 'object' || Array.isArray(rawTrees)) {
    return issues; // No behavior trees defined — skip
  }

  // Zod schema validation
  try {
    btTreeMapSchema.parse(rawTrees);
    issues.push({ severity: 'PASS', message: 'behavior_trees 定义 schema 校验通过' });
  } catch (error) {
    issues.push({
      severity: 'FAIL',
      message: `behavior_trees schema 校验失败: ${error instanceof Error ? error.message : String(error)}`
    });
    return issues;
  }

  // TreeRegistry validation ($ref, cycles, depth, Parallel, Sequence actions)
  try {
    const registry = new TreeRegistry('validation');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- CLI output serialization
    registry.register(rawTrees as Record<string, unknown>);
    // Verify all trees can be expanded
    for (const name of registry.list()) {
      try {
        registry.get(name);
      } catch (error) {
        issues.push({
          severity: 'FAIL',
          message: `behavior_tree "${name}" 展开失败: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }
    if (issues.filter((i) => i.severity === 'FAIL').length === 0) {
      issues.push({ severity: 'PASS', message: `behavior_trees 校验通过 (${registry.list().length} 棵树)` });
    }
  } catch (error) {
    issues.push({
      severity: 'FAIL',
      message: `behavior_trees 注册失败: ${error instanceof Error ? error.message : String(error)}`
    });
  }

  return issues;
};

const validatePack = (packDir: string): PackValidationResult => {
  const issues: ValidationIssue[] = [];
  const dirName = path.basename(packDir);

  if (!existsSync(packDir)) {
    issues.push({ severity: 'FAIL', message: `目录不存在: ${packDir}` });
    return { packDir, issues };
  }

  issues.push(...validateConfig(packDir));
  issues.push(...validateReadme(packDir));
  issues.push(...validatePlugins(packDir));

  return { packDir: dirName, issues };
};

const discoverPacks = (): string[] => {
  if (!existsSync(defaultPacksDir)) {
    return [];
  }

  return readdirSync(defaultPacksDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(defaultPacksDir, d.name));
};

const printResult = (result: PackValidationResult): void => {
  const warnCount = result.issues.filter((i) => i.severity === 'WARN').length;
  const failCount = result.issues.filter((i) => i.severity === 'FAIL').length;

  const overall = failCount === 0 ? (warnCount === 0 ? 'PASS' : 'PASS (有警告)') : 'FAIL';

  console.log(`\n${result.packDir}  [${overall}]`);

  for (const issue of result.issues) {
    const icon = issue.severity === 'PASS' ? '  ✓' : issue.severity === 'WARN' ? '  ⚠' : '  ✗';
    console.log(`${icon} ${issue.message}`);
  }
};

const runCli = (): void => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args.all && !args.packDir)) {
    printHelp();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  try {
    if (args.all) {
      const packs = discoverPacks();
      if (packs.length === 0) {
        console.error(`错误: ${defaultPacksDir} 下没有找到 world pack`);
        process.exitCode = 1;
        return;
      }

      console.log(`校验 ${packs.length} 个 world pack...`);
      let totalPass = 0;
      let totalFail = 0;

      for (const packPath of packs) {
        const result = validatePack(packPath);
        printResult(result);
        if (result.issues.some((i) => i.severity === 'FAIL')) {
          totalFail++;
        } else {
          totalPass++;
        }
      }

      console.log(`\n总计: ${totalPass} 通过, ${totalFail} 失败`);
      if (totalFail > 0) {
        process.exitCode = 1;
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- args.packDir validated above
      const packDir = path.resolve(args.packDir!);
      const result = validatePack(packDir);
      printResult(result);
      if (result.issues.some((i) => i.severity === 'FAIL')) {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error('错误:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

runCli();
