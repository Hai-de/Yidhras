import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as YAML from 'yaml';

import { resolveWorkspaceRoot } from '../config/loader.js';
import { parseWorldPackConstitution } from '../packs/schema/constitution_schema.js';

const workspaceRoot = resolveWorkspaceRoot();
const defaultPacksDir = path.join(workspaceRoot, 'data', 'world_packs');

const CONFIG_CANDIDATES = ['pack.yaml', 'pack.yml'];

const EXCLUDE_PATTERNS = ['.git', 'node_modules', 'runtime', '*.tmp', '*.swp', '.DS_Store'];

interface ParsedArgs {
  help?: boolean;
  json?: boolean;
  force?: boolean;
  command?: 'export' | 'import';
  target?: string;
  output?: string;
}

const printHelp = (): void => {
  console.log(`pack:export — 世界包导出/导入

用法:
  pnpm pack:export <pack-dir> [--output <path>] [--force]  导出 world pack 为 .tar.gz
  pnpm pack:import <archive> [--force]                       导入 .tar.gz 到本地
  pnpm pack:export --help                                    显示此帮助

选项:
  --output <path>  指定输出路径 (默认: 当前目录)
  --force           导出时跳过校验; 导入时覆盖已存在的 pack
  --json            JSON 格式输出
`);
};

const parseArgs = (argv: string[]): ParsedArgs => {
  const parsed: ParsedArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--force':
        parsed.force = true;
        break;
      case '--output':
        if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          parsed.output = argv[++i];
        }
        break;
      default:
        if (!arg.startsWith('-')) {
          if (!parsed.command) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
            parsed.command = arg as 'export' | 'import';
          } else if (!parsed.target) {
            parsed.target = arg;
          }
        }
    }
  }

  if (!parsed.command && parsed.target) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    parsed.command = parsed.target as 'export' | 'import';
    parsed.target = undefined;
  }

  return parsed;
};

const findConfigFile = (dir: string): string | null => {
  for (const name of CONFIG_CANDIDATES) {
    const fullPath = path.join(dir, name);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
};

const readPackMetadata = (packDir: string): { id: string; version: string } | null => {
  const configPath = findConfigFile(packDir);
  if (!configPath) return null;

  let parsed: unknown;
  try {
    parsed = YAML.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- CLI output serialization
  const obj = parsed as Record<string, unknown>;
  const meta = obj.metadata;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- CLI output serialization
  const metaObj = meta as Record<string, unknown>;
  const id = typeof metaObj.id === 'string' ? metaObj.id : null;
  const version = typeof metaObj.version === 'string' ? metaObj.version : null;

  if (!id || !version) return null;

  return { id, version };
};

const readYaml = (filePath: string): unknown => {
  return YAML.parse(readFileSync(filePath, 'utf-8'));
};

const buildExcludeArgs = (): string[] => {
  return EXCLUDE_PATTERNS.flatMap((pattern) => ['--exclude', pattern]);
};

const emitJson = (data: Record<string, unknown>): void => {
  console.log(JSON.stringify(data, null, 2));
};

const cmdExport = (packDir: string, outputPath: string | undefined, force: boolean, json: boolean): void => {
  const resolvedPackDir = path.resolve(packDir);

  if (!existsSync(resolvedPackDir)) {
    if (json) emitJson({ success: false, error: `目录不存在: ${resolvedPackDir}` });
    else console.error(`错误: 目录不存在: ${resolvedPackDir}`);
    process.exitCode = 1;
    return;
  }

  const metadata = readPackMetadata(resolvedPackDir);
  if (!metadata) {
    const msg = '无法从 pack.yaml 读取 metadata.id 或 metadata.version';
    if (json) emitJson({ success: false, error: msg });
    else console.error(`错误: ${msg}`);
    process.exitCode = 1;
    return;
  }

  if (!force) {
    try {
      const configPath = findConfigFile(resolvedPackDir);
      if (configPath) {
        const parsed = readYaml(configPath);
        parseWorldPackConstitution(parsed, path.basename(resolvedPackDir));
      }
    } catch (error) {
      const msg = `校验失败 (使用 --force 跳过): ${error instanceof Error ? error.message : String(error)}`;
      if (json) emitJson({ success: false, error: msg });
      else console.error(`错误: ${msg}`);
      process.exitCode = 1;
      return;
    }
  }

  const archiveName = `${metadata.id}-${metadata.version}.tar.gz`;
  const resolvedOutput = path.resolve(outputPath || '.');
  const archivePath = path.join(resolvedOutput, archiveName);
  const checksumPath = `${archivePath}.sha256`;

  if (!force && existsSync(archivePath)) {
    const msg = `输出文件已存在: ${archivePath} (使用 --force 覆盖)`;
    if (json) emitJson({ success: false, error: msg });
    else console.error(`错误: ${msg}`);
    process.exitCode = 1;
    return;
  }

  if (!existsSync(resolvedOutput)) {
    mkdirSync(resolvedOutput, { recursive: true });
  }

  const excludeArgs = buildExcludeArgs();

  try {
    execSync(
      `tar -czf "${archivePath}" ${excludeArgs.join(' ')} -C "${resolvedPackDir}" .`,
      { stdio: 'pipe' }
    );
  } catch (error) {
    const msg = `打包失败: ${error instanceof Error ? error.message : String(error)}`;
    if (json) emitJson({ success: false, error: msg });
    else console.error(`错误: ${msg}`);
    process.exitCode = 1;
    return;
  }

  const fileContent = readFileSync(archivePath);
  const hash = createHash('sha256').update(fileContent).digest('hex');
  writeFileSync(checksumPath, `${hash}  ${archiveName}\n`, 'utf-8');

  if (json) {
    emitJson({
      success: true,
      archive: archivePath,
      checksum: checksumPath,
      sha256: hash,
      pack_id: metadata.id,
      version: metadata.version
    });
  } else {
    console.log(`导出成功: ${archivePath}`);
    console.log(`SHA256:    ${hash}`);
    console.log(`校验文件:  ${checksumPath}`);
  }
};

const cmdImport = (archivePath: string, force: boolean, json: boolean): void => {
  const resolvedArchive = path.resolve(archivePath);

  if (!existsSync(resolvedArchive)) {
    if (json) emitJson({ success: false, error: `归档文件不存在: ${resolvedArchive}` });
    else console.error(`错误: 归档文件不存在: ${resolvedArchive}`);
    process.exitCode = 1;
    return;
  }

  const tempDir = mkdtempSync(path.join(tmpdir(), 'yidhras-pack-import-'));

  try {
    execSync(`tar -xzf "${resolvedArchive}" -C "${tempDir}"`, { stdio: 'pipe' });
  } catch (error) {
    const msg = `解压失败: ${error instanceof Error ? error.message : String(error)}`;
    if (json) emitJson({ success: false, error: msg });
    else console.error(`错误: ${msg}`);
    process.exitCode = 1;
    rmSync(tempDir, { recursive: true, force: true });
    return;
  }

  const metadata = readPackMetadata(tempDir);
  if (!metadata) {
    const msg = '无法从归档中读取 metadata.id 或 metadata.version';
    if (json) emitJson({ success: false, error: msg });
    else console.error(`错误: ${msg}`);
    process.exitCode = 1;
    rmSync(tempDir, { recursive: true, force: true });
    return;
  }

  try {
    const configPath = findConfigFile(tempDir);
    if (configPath) {
      const parsed = readYaml(configPath);
      parseWorldPackConstitution(parsed, metadata.id);
    }
  } catch (error) {
    const msg = `归档内容校验失败: ${error instanceof Error ? error.message : String(error)}`;
    if (json) emitJson({ success: false, error: msg });
    else console.error(`错误: ${msg}`);
    process.exitCode = 1;
    rmSync(tempDir, { recursive: true, force: true });
    return;
  }

  const targetDir = path.join(defaultPacksDir, metadata.id);

  if (existsSync(targetDir)) {
    if (!force) {
      const msg = `目标 pack 已存在: ${targetDir} (使用 --force 覆盖)`;
      if (json) emitJson({ success: false, error: msg });
      else console.error(`错误: ${msg}`);
      process.exitCode = 1;
      rmSync(tempDir, { recursive: true, force: true });
      return;
    }
    rmSync(targetDir, { recursive: true, force: true });
  }

  if (!existsSync(defaultPacksDir)) {
    mkdirSync(defaultPacksDir, { recursive: true });
  }

  try {
    execSync(`mv "${tempDir}" "${targetDir}"`);
  } catch (error) {
    const msg = `移动到 packs 目录失败: ${error instanceof Error ? error.message : String(error)}`;
    if (json) emitJson({ success: false, error: msg });
    else console.error(`错误: ${msg}`);
    process.exitCode = 1;
    rmSync(tempDir, { recursive: true, force: true });
    return;
  }

  if (json) {
    emitJson({
      success: true,
      pack_id: metadata.id,
      version: metadata.version,
      installed_to: targetDir
    });
  } else {
    console.log(`导入成功: ${targetDir} (${metadata.id} v${metadata.version})`);
  }
};

const runCli = (): void => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.command) {
    printHelp();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  try {
    if (args.command === 'export') {
      if (!args.target) {
        console.error('错误: 缺少 pack 目录参数');
        printHelp();
        process.exitCode = 1;
        return;
      }
      cmdExport(args.target, args.output, !!args.force, !!args.json);
    } else if (args.command === 'import') {
      if (!args.target) {
        console.error('错误: 缺少归档文件参数');
        printHelp();
        process.exitCode = 1;
        return;
      }
      cmdImport(args.target, !!args.force, !!args.json);
    } else {
      console.error(`错误: 未知命令 "${String(args.command)}"，应为 export 或 import`);
      printHelp();
      process.exitCode = 1;
    }
  } catch (error) {
    if (args.json) {
      emitJson({ success: false, error: error instanceof Error ? error.message : String(error) });
    } else {
      console.error('错误:', error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
};

runCli();
