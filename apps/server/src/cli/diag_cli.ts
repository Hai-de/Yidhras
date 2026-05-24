import 'dotenv/config';

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as YAML from 'yaml';

import { resolveWorkspaceRoot } from '../config/loader.js';
import { createPrismaClient } from '../db/client.js';

const workspaceRoot = resolveWorkspaceRoot();
const dataDir = path.join(workspaceRoot, 'data');
const dbPath = path.join(dataDir, 'yidhras.sqlite');
const configDir = path.join(dataDir, 'configw');
const confDir = path.join(configDir, 'conf.d');
const packsDir = path.join(dataDir, 'world_packs');
const backupsDir = path.join(dataDir, 'backups', 'config');

interface ParsedArgs {
  help?: boolean;
  json?: boolean;
}

const parseArgs = (argv: string[]): ParsedArgs => {
  const parsed: ParsedArgs = {};

  for (const arg of argv) {
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--json':
        parsed.json = true;
        break;
    }
  }

  return parsed;
};

const printHelp = (): void => {
  console.log(`diag — 运行时诊断

用法:
  pnpm diag                完整诊断报告
  pnpm diag --json         JSON 格式输出
  pnpm diag --help         显示此帮助
`);
};

const formatBytes = (bytes: number): string => {
  const kb = bytes / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`;
};

interface DiagReport {
  workspace: { path: string };
  database: { path: string; exists: boolean; size: string; walSize: string; integrity: string; migrations: number };
  config: { confDir: string; files: string[]; domains: number };
  packs: { dir: string; count: number; items: { id: string; name: string; version: string }[] };
  backups: { dir: string; count: number; totalSize: string };
  environment: { nodeVersion: string; platform: string; cwd: string; env: Record<string, string> };
}

const buildReport = async (): Promise<DiagReport> => {
  const dbExists = existsSync(dbPath);
  const dbSize = dbExists ? statSync(dbPath).size : 0;
  const walPath = `${dbPath}-wal`;
  const walSize = existsSync(walPath) ? statSync(walPath).size : 0;

  let integrity = 'N/A';
  let migrationCount = 0;

  if (dbExists) {
    const prisma = createPrismaClient();
    try {
      await prisma.$connect();
      const rows = await prisma.$queryRawUnsafe<{ integrity_check: string }[]>('PRAGMA integrity_check');
      integrity = rows.map((r) => r.integrity_check).join('; ');

      const migrations = await prisma.$queryRawUnsafe<{ cnt: number }[]>(
        'SELECT COUNT(*) as cnt FROM "_prisma_migrations"'
      );
      migrationCount = migrations[0]?.cnt ?? 0;
    } catch {
      integrity = '查询失败';
    } finally {
      await prisma.$disconnect();
    }
  }

  const confFiles = existsSync(confDir) ? readdirSync(confDir).filter((f) => f.endsWith('.yaml')) : [];

  const packs: DiagReport['packs']['items'] = [];
  if (existsSync(packsDir)) {
    for (const entry of readdirSync(packsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const configPath = path.join(packsDir, entry.name, 'pack.yaml');
      if (existsSync(configPath)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- CLI output serialization
          const yaml = YAML.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
          const meta = (yaml.metadata ?? {}) as Record<string, string>;
          packs.push({
            id: meta.id ?? entry.name,
            name: meta.name ?? entry.name,
            version: meta.version ?? '?'
          });
        } catch {
          packs.push({ id: entry.name, name: entry.name, version: '解析失败' });
        }
      }
    }
  }

  let backupCount = 0;
  let backupTotalSize = 0;
  if (existsSync(backupsDir)) {
    for (const entry of readdirSync(backupsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        backupCount++;
        try {
          const files = readdirSync(path.join(backupsDir, entry.name));
          for (const f of files) {
            backupTotalSize += statSync(path.join(backupsDir, entry.name, f)).size;
          }
        } catch {
          // skip unreadable backups
        }
      }
    }
  }

  const safeEnv: Record<string, string> = {};
  const envKeys = ['NODE_ENV', 'DATABASE_URL', 'YIDHRAS_TOKEN', 'WORKSPACE_ROOT'];
  for (const key of envKeys) {
    if (process.env[key]) {
      const val = process.env[key];
      safeEnv[key] = key === 'DATABASE_URL' ? val.replace(/\/\/.*@/, '//***@') : val;
    }
  }

  return {
    workspace: { path: workspaceRoot },
    database: {
      path: dbPath,
      exists: dbExists,
      size: formatBytes(dbSize),
      walSize: formatBytes(walSize),
      integrity,
      migrations: migrationCount
    },
    config: { confDir: confDir, files: confFiles, domains: confFiles.length },
    packs: { dir: packsDir, count: packs.length, items: packs },
    backups: { dir: backupsDir, count: backupCount, totalSize: formatBytes(backupTotalSize) },
    environment: {
      nodeVersion: process.version,
      platform: `${os.platform()} ${os.release()}`,
      cwd: process.cwd(),
      env: safeEnv
    }
  };
};

const printText = (report: DiagReport): void => {
  const { database, config, packs, backups, environment } = report;

  console.log('══════════════════════════════════════');
  console.log('  Yidhras 运行时诊断');
  console.log('══════════════════════════════════════');

  console.log('\n── 数据库 ──');
  console.log(`  路径:     ${database.path}`);
  console.log(`  状态:     ${database.exists ? `存在 (${database.size})` : '不存在'}`);
  console.log(`  WAL:      ${database.walSize}`);
  console.log(`  完整性:   ${database.integrity}`);
  console.log(`  迁移数:   ${database.migrations}`);

  console.log('\n── 配置 ──');
  console.log(`  目录:     ${config.confDir}`);
  console.log(`  文件:     ${config.domains} 个域 (${config.files.join(', ') || '无'})`);

  console.log('\n── World Packs ──');
  console.log(`  目录:     ${packs.dir}`);
  console.log(`  数量:     ${packs.count}`);
  for (const pack of packs.items) {
    console.log(`    ${pack.id} — ${pack.name} v${pack.version}`);
  }

  console.log('\n── 备份 ──');
  console.log(`  目录:     ${backups.dir}`);
  console.log(`  数量:     ${backups.count}`);
  console.log(`  总大小:   ${backups.totalSize}`);

  console.log('\n── 环境 ──');
  console.log(`  Node.js:  ${environment.nodeVersion}`);
  console.log(`  平台:     ${environment.platform}`);
  console.log(`  CWD:      ${environment.cwd}`);
  for (const [key, val] of Object.entries(environment.env)) {
    console.log(`  ${key}: ${val}`);
  }

  console.log('\n══════════════════════════════════════');
};

const runCli = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  try {
    const report = await buildReport();
    if (args.json) {
      console.log(
        JSON.stringify(
          report,
          (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
          2
        )
      );
    } else {
      printText(report);
    }
  } catch (error) {
    console.error('错误:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

void runCli();
