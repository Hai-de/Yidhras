import 'dotenv/config';

import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { resolveWorkspaceRoot } from '../config/loader.js';
import { archiveConversationEntriesToColdStorage } from '../conversation/cold_archive_service.js';
import { createPrismaClient } from '../db/client.js';

const workspaceRoot = resolveWorkspaceRoot();
const serverDir = path.join(workspaceRoot, 'apps', 'server');
const dbDir = path.join(workspaceRoot, 'data');
const dbPath = path.join(dbDir, 'yidhras.sqlite');
const walPath = `${dbPath}-wal`;
const shmPath = `${dbPath}-shm`;

const COMMANDS = ['status', 'migrate', 'integrity', 'tables', 'archive-conversations'] as const;

interface ParsedArgs {
  command?: string;
  help?: boolean;
  memoryId?: string;
  beforeRecordedAt?: string;
  beforeTurn?: number;
  limit?: number;
  outputDir?: string;
}

const printHelp = (): void => {
  console.log(`db — 数据库管理

用法:
  pnpm db status                数据库迁移状态与文件信息
  pnpm db migrate               执行待处理的迁移
  pnpm db integrity             运行 PRAGMA integrity_check
  pnpm db tables                列出所有表及行数
  pnpm db archive-conversations [--memory-id <id>] [--before-recorded-at <n>] [--before-turn <n>] [--limit <n>] [--output-dir <path>]
                                导出 archived conversation entries 到 JSON 冷存储后删除 DB 行
  pnpm db --help                显示此帮助
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
      case '--memory-id':
        parsed.memoryId = argv[++i];
        break;
      case '--before-recorded-at':
        parsed.beforeRecordedAt = argv[++i];
        break;
      case '--before-turn':
        parsed.beforeTurn = Number.parseInt(argv[++i], 10);
        break;
      case '--limit':
        parsed.limit = Number.parseInt(argv[++i], 10);
        break;
      case '--output-dir':
        parsed.outputDir = argv[++i];
        break;
      default:
        if (COMMANDS.includes(arg as (typeof COMMANDS)[number])) {
          parsed.command = arg;
        }
    }
  }

  return parsed;
};

const formatBytes = (bytes: number): string => {
  const kb = bytes / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`;
};

const getDbFileInfo = (): { path: string; exists: boolean; sizeBytes: number; walSizeBytes: number } => {
  const exists = existsSync(dbPath);
  const sizeBytes = exists ? statSync(dbPath).size : 0;
  const walSizeBytes = existsSync(walPath) ? statSync(walPath).size : 0;
  return { path: dbPath, exists, sizeBytes, walSizeBytes };
};

const runStatus = async (prisma: PrismaClient): Promise<void> => {
  const fileInfo = getDbFileInfo();

  console.log('数据库文件:');
  console.log(`  路径:     ${fileInfo.path}`);
  console.log(`  大小:     ${fileInfo.exists ? formatBytes(fileInfo.sizeBytes) : '(不存在)'}`);
  console.log(`  WAL:      ${fileInfo.walSizeBytes > 0 ? formatBytes(fileInfo.walSizeBytes) : '无'}`);
  console.log(`  SHM:      ${existsSync(shmPath) ? '存在' : '无'}`);

  if (!fileInfo.exists) {
    console.log('\n迁移状态: 数据库文件不存在，请先运行 pnpm prepare:runtime');
    return;
  }

  const migrations = await prisma.$queryRawUnsafe<{ migration_name: string; finished_at: string }[]>(
    'SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at DESC'
  );

  console.log(`\n已应用迁移 (${migrations.length} 个):`);
  if (migrations.length === 0) {
    console.log('  (无)');
  } else {
    for (const m of migrations) {
      console.log(`  ${m.migration_name}  — ${m.finished_at}`);
    }
  }
};

const runMigrate = (): void => {
  const schemaFile = path.join(serverDir, 'prisma', 'schema.sqlite.prisma');
  if (!existsSync(schemaFile)) {
    console.error(`错误: schema 文件不存在: ${schemaFile}`);
    process.exitCode = 1;
    return;
  }

  console.log(`运行迁移 (schema: prisma/schema.sqlite.prisma)...`);
  execSync('pnpm exec prisma migrate deploy --schema=prisma/schema.sqlite.prisma', {
    cwd: serverDir,
    stdio: 'inherit'
  });
  console.log('迁移完成');
};

const runIntegrity = async (prisma: PrismaClient): Promise<void> => {
  const rows = await prisma.$queryRawUnsafe<{ integrity_check: string }[]>('PRAGMA integrity_check');
  console.log('完整性检查结果:');
  for (const row of rows) {
    const status = row.integrity_check === 'ok' ? 'PASS' : 'FAIL';
    console.log(`  ${status}  ${row.integrity_check}`);
  }
};

const runTables = async (prisma: PrismaClient): Promise<void> => {
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_prisma_%' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );

  if (tables.length === 0) {
    console.log('没有找到用户表');
    return;
  }

  const nameWidth = Math.max(...tables.map((t) => t.name.length), 4);

  console.log(`${'表名'.padEnd(nameWidth)}  行数`);
  console.log(`${'-'.repeat(nameWidth)}  -----`);

  for (const table of tables) {
    const countResult = await prisma.$queryRawUnsafe<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM "${table.name}"`
    );
    const count = countResult[0]?.count ?? 0;
    console.log(`${table.name.padEnd(nameWidth)}  ${count}`);
  }
};

const runArchiveConversations = async (prisma: PrismaClient, args: ParsedArgs): Promise<void> => {
  const result = await archiveConversationEntriesToColdStorage(prisma, {
    memoryId: args.memoryId,
    beforeRecordedAt: args.beforeRecordedAt,
    beforeTurn: args.beforeTurn,
    limit: args.limit,
    outputDir: args.outputDir
  });

  if (result.exportedCount === 0) {
    console.log('没有找到可归档的 archived conversation entries。');
    return;
  }

  console.log('Conversation entries 冷存储归档完成:');
  console.log(`  Archive ID: ${result.archiveId}`);
  console.log(`  文件:       ${result.archivePath}`);
  console.log(`  导出:       ${result.exportedCount}`);
  console.log(`  删除:       ${result.deletedCount}`);
  console.log(`  大小:       ${formatBytes(result.sizeBytes)}`);
};

const runCli = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.command) {
    printHelp();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const needsPrisma = args.command === 'status' || args.command === 'integrity' || args.command === 'tables' || args.command === 'archive-conversations';
  let prisma: PrismaClient | undefined;

  try {
    if (needsPrisma) {
      prisma = createPrismaClient();
      await prisma.$connect();
    }

    switch (args.command) {
      case 'status':
        await runStatus(prisma!);
        break;
      case 'migrate':
        runMigrate();
        break;
      case 'integrity':
        await runIntegrity(prisma!);
        break;
      case 'tables':
        await runTables(prisma!);
        break;
      case 'archive-conversations':
        await runArchiveConversations(prisma!, args);
        break;
      default:
        console.error(`错误: 未知命令 "${args.command}"。使用 --help 查看帮助。`);
        process.exitCode = 1;
    }
  } catch (error) {
    console.error('错误:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (prisma) {
      await prisma.$disconnect();
    }
  }
};

void runCli();
