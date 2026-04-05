import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { resolveWorkspaceRoot } from '../config/loader.js';

const DATABASE_FILE_BASENAME = 'yidhras.sqlite';
const DATABASE_SIDE_CAR_SUFFIXES = ['', '-wal', '-shm'];

const resolveWorkspaceDatabaseFiles = (workspaceRoot: string): string[] => {
  const databasePath = path.join(workspaceRoot, 'data', DATABASE_FILE_BASENAME);
  return DATABASE_SIDE_CAR_SUFFIXES.map(suffix => `${databasePath}${suffix}`);
};

const assertNoRunningDevServer = (): void => {
  const psResult = spawnSync('bash', ['-lc', "ps -ef | grep -E 'tsx .*src/index.ts|pnpm --filter yidhras-server dev|npm run serve:e2e' | grep -v grep"], {
    encoding: 'utf-8'
  });

  const output = `${psResult.stdout ?? ''}${psResult.stderr ?? ''}`.trim();
  if (output.length > 0) {
    throw new Error(`检测到正在运行的 server 进程，请先停止后再重置数据库:\n${output}`);
  }
};

const removeDatabaseFiles = (files: string[]): void => {
  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    fs.rmSync(filePath, { force: true });
    console.log(`[reset_dev_db] removed ${filePath}`);
  }
};

const runWorkspaceCommand = (workspaceRoot: string, command: string, args: string[]): void => {
  console.log(`[reset_dev_db] running: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    stdio: 'inherit',
    env: process.env
  });

  if (result.status !== 0) {
    throw new Error(`命令执行失败: ${command} ${args.join(' ')}`);
  }
};

const main = (): void => {
  const workspaceRoot = resolveWorkspaceRoot();
  const databaseFiles = resolveWorkspaceDatabaseFiles(workspaceRoot);

  assertNoRunningDevServer();
  removeDatabaseFiles(databaseFiles);
  runWorkspaceCommand(workspaceRoot, 'pnpm', ['--filter', 'yidhras-server', 'exec', 'prisma', 'migrate', 'deploy']);
  runWorkspaceCommand(workspaceRoot, 'pnpm', ['--filter', 'yidhras-server', 'run', 'init:runtime']);
  runWorkspaceCommand(workspaceRoot, 'pnpm', ['--filter', 'yidhras-server', 'run', 'seed:identity']);

  console.log('[reset_dev_db] development database reset complete');
};

main();
