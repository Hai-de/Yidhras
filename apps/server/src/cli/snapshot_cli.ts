import 'dotenv/config';

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { resolveWorkspaceRoot } from '../config/loader.js';
import {
  deleteSnapshotDir,
  listSnapshotDirs,
  readSnapshotMetadata,
  resolveSnapshotLocation,
  snapshotFilesExist
} from '../packs/snapshots/snapshot_locator.js';

const workspaceRoot = resolveWorkspaceRoot();
const packsDir = path.join(workspaceRoot, 'data', 'world_packs');

const COMMANDS = ['list', 'show', 'delete'] as const;

interface ParsedArgs {
  command?: string;
  packId?: string;
  snapshotId?: string;
  force?: boolean;
  limit?: number;
  help?: boolean;
}

const parseArgs = (argv: string[]): ParsedArgs => {
  const parsed: ParsedArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--pack':
        parsed.packId = argv[++i];
        break;
      case '--force':
        parsed.force = true;
        break;
      case '--limit':
        parsed.limit = parseInt(argv[++i], 10);
        break;
      default:
        if (COMMANDS.includes(arg as (typeof COMMANDS)[number])) {
          parsed.command = arg;
        } else if (!arg.startsWith('-') && !parsed.command) {
          parsed.command = arg;
        } else if (!arg.startsWith('-') && parsed.command && !parsed.snapshotId) {
          parsed.snapshotId = arg;
        }
    }
  }

  return parsed;
};

const printHelp = (): void => {
  console.log(`snapshot — 世界包快照管理

用法:
  pnpm snapshot list --pack <pack-id> [--limit <n>]    列出快照
  pnpm snapshot show <snapshot-id> --pack <pack-id>     查看快照详情
  pnpm snapshot delete <snapshot-id> --pack <pack-id> [--force]  删除快照
  pnpm snapshot --help                                  显示此帮助

注意: 创建和恢复快照需要服务器运行中，请使用 HTTP API:
  POST /api/packs/snapshots         创建快照
  POST /api/packs/snapshots/:id/restore  恢复快照
`);
};

const discoverPacks = (): string[] => {
  if (!existsSync(packsDir)) {
    return [];
  }

  return readdirSync(packsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
};

const doList = (args: ParsedArgs): void => {
  if (!args.packId) {
    const packs = discoverPacks();
    if (packs.length === 0) {
      console.log('没有找到 world pack');
      return;
    }

    console.log('所有 pack 的快照:');
    for (const packId of packs) {
      const dirs = listSnapshotDirs(packId);
      if (dirs.length > 0) {
        console.log(`\n  ${packId} (${dirs.length} 个快照):`);
        for (const dir of dirs.slice(0, args.limit ?? 50)) {
          const loc = resolveSnapshotLocation(packId, dir);
          try {
            const meta = readSnapshotMetadata(loc);
            console.log(`    ${meta.snapshot_id}`);
            console.log(`      标签: ${meta.label ?? '(无)'}  |  捕获 tick: ${meta.captured_at_tick}  |  时间: ${meta.captured_at_timestamp}`);
          } catch {
            console.log(`    ${dir} (损坏 — 无法读取元数据)`);
          }
        }
      }
    }
    return;
  }

  const dirs = listSnapshotDirs(args.packId);

  if (dirs.length === 0) {
    console.log(`pack "${args.packId}" 没有快照`);
    return;
  }

  const limit = args.limit ?? 50;
  const shown = dirs.slice(0, limit);

  console.log(`pack "${args.packId}" 的快照 (${shown.length}/${dirs.length}):`);

  for (const dir of shown) {
    const loc = resolveSnapshotLocation(args.packId, dir);
    try {
      const meta = readSnapshotMetadata(loc);
      console.log(`  ${meta.snapshot_id}`);
      console.log(`    标签: ${meta.label ?? '(无)'}  |  捕获 tick: ${meta.captured_at_tick}  |  时间: ${meta.captured_at_timestamp}`);
      console.log(`    数据库: ${meta.runtime_db_size_bytes} bytes  |  记录: ${meta.prisma_record_count}`);
    } catch {
      console.log(`  ${dir} (损坏 — 无法读取元数据)`);
    }
  }
};

const doShow = (args: ParsedArgs): void => {
  if (!args.packId) {
    console.error('错误: 请通过 --pack <pack-id> 指定 pack');
    process.exitCode = 1;
    return;
  }
  if (!args.snapshotId) {
    console.error('错误: 请指定快照 ID (pnpm snapshot show <id> --pack <pack>)');
    process.exitCode = 1;
    return;
  }

  const loc = resolveSnapshotLocation(args.packId, args.snapshotId);

  if (!snapshotFilesExist(loc)) {
    console.error(`错误: 快照 ${args.snapshotId} 不存在或不完整 (pack: ${args.packId})`);
    process.exitCode = 1;
    return;
  }

  const meta = readSnapshotMetadata(loc);

  console.log('快照详情:');
  console.log(`  快照 ID:         ${meta.snapshot_id}`);
  console.log(`  Pack ID:         ${meta.pack_id}`);
  console.log(`  标签:            ${meta.label ?? '(无)'}`);
  console.log(`  版本:            ${meta.schema_version}`);
  console.log(`  捕获 tick:       ${meta.captured_at_tick}`);
  console.log(`  捕获 revision:   ${meta.captured_at_revision}`);
  console.log(`  捕获时间:        ${meta.captured_at_timestamp}`);
  console.log(`  DB 大小:         ${meta.runtime_db_size_bytes} bytes`);
  console.log(`  记录数:          ${meta.prisma_record_count}`);
  console.log(`  压缩:            ${meta.compression}`);
  if (meta.storage_plan_inherits_from) {
    console.log(`  继承自:          ${meta.storage_plan_inherits_from}`);
  }
  if (meta.storage_plan_sha256) {
    console.log(`  Plan SHA256:     ${meta.storage_plan_sha256}`);
  }
  console.log(`  路径:            ${loc.snapshotDir}`);
};

const doDelete = (args: ParsedArgs): void => {
  if (!args.packId) {
    console.error('错误: 请通过 --pack <pack-id> 指定 pack');
    process.exitCode = 1;
    return;
  }
  if (!args.snapshotId) {
    console.error('错误: 请指定快照 ID (pnpm snapshot delete <id> --pack <pack>)');
    process.exitCode = 1;
    return;
  }

  const loc = resolveSnapshotLocation(args.packId, args.snapshotId);

  if (!snapshotFilesExist(loc) && !existsSync(loc.snapshotDir)) {
    console.error(`错误: 快照 ${args.snapshotId} 不存在 (pack: ${args.packId})`);
    process.exitCode = 1;
    return;
  }

  if (!args.force) {
    console.log(`即将删除快照 ${args.snapshotId} (pack: ${args.packId})`);
    console.log(`路径: ${loc.snapshotDir}`);
    console.log('');
    console.log('使用 --force 确认删除。');
    return;
  }

  deleteSnapshotDir(loc);
  console.log(`快照 ${args.snapshotId} 已删除`);
};

const runCli = (): void => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.command) {
    printHelp();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  try {
    switch (args.command) {
      case 'list':
        doList(args);
        break;
      case 'show':
        doShow(args);
        break;
      case 'delete':
        doDelete(args);
        break;
      default:
        console.error(`错误: 未知命令 "${args.command}"。使用 --help 查看帮助。`);
        process.exitCode = 1;
    }
  } catch (error) {
    console.error('错误:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

runCli();
