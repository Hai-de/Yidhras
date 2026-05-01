import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../operator/auth/password.js';

const COMMANDS = ['create', 'list', 'show', 'update', 'delete'] as const;

interface ParsedArgs {
  command?: string;
  id?: string;
  name?: string;
  displayName?: string;
  role?: string;
  isRoot?: boolean;
  password?: string;
  status?: string;
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
      case '--name':
        parsed.name = argv[++i];
        break;
      case '--display-name':
        parsed.displayName = argv[++i];
        break;
      case '--password':
        parsed.password = argv[++i];
        break;
      case '--role':
        parsed.role = argv[++i];
        break;
      case '--root':
        parsed.isRoot = true;
        break;
      case '--status':
        parsed.status = argv[++i];
        break;
      case '--limit':
        parsed.limit = parseInt(argv[++i], 10);
        break;
      default:
        if (COMMANDS.includes(arg as (typeof COMMANDS)[number])) {
          parsed.command = arg;
        } else if (!arg.startsWith('-') && !parsed.command) {
          parsed.command = arg;
        } else if (!arg.startsWith('-') && parsed.command && !parsed.id) {
          parsed.id = arg;
        }
    }
  }

  return parsed;
};

const printHelp = (): void => {
  console.log(`operator — 操作者管理

用法:
  pnpm operator create --name <username> --password <pwd> [--display-name <name>] [--root]
  pnpm operator list [--limit <n>]
  pnpm operator show <id>
  pnpm operator update <id> [--password <pwd>] [--display-name <name>] [--status active|disabled|suspended] [--root]
  pnpm operator delete <id>
  pnpm operator --help

选项:
  --name <username>       用户名
  --password <password>   密码 (最少 8 字符)
  --display-name <name>   显示名称
  --root                  设为 root 操作者
  --status <status>       状态: active | disabled | suspended
  --limit <n>             列表数量上限
`);
};

const validateUsername = (username: string): void => {
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    throw new Error('用户名只能包含字母、数字、下划线和连字符');
  }
};

const validatePassword = (password: string): void => {
  if (password.length < 8 || password.length > 128) {
    throw new Error('密码长度必须在 8-128 字符之间');
  }
};

const validateStatus = (status: string): void => {
  if (!['active', 'disabled', 'suspended'].includes(status)) {
    throw new Error(`无效的状态 "${status}"。允许: active, disabled, suspended`);
  }
};

const doCreate = async (prisma: PrismaClient, args: ParsedArgs): Promise<void> => {
  if (!args.name || !args.password) {
    console.error('错误: create 需要 --name 和 --password');
    process.exitCode = 1;
    return;
  }

  validateUsername(args.name);
  validatePassword(args.password);

  const existing = await prisma.operator.findUnique({ where: { username: args.name } });
  if (existing) {
    console.error(`错误: 用户名 "${args.name}" 已被占用`);
    process.exitCode = 1;
    return;
  }

  const identityId = randomUUID();
  const operatorId = randomUUID();
  const now = BigInt(Date.now());
  const passwordHash = await hashPassword(args.password);

  await prisma.identity.create({
    data: {
      id: identityId,
      type: 'user',
      name: args.name,
      provider: 'operator',
      status: 'active',
      created_at: now,
      updated_at: now
    }
  });

  const operator = await prisma.operator.create({
    data: {
      id: operatorId,
      identity_id: identityId,
      username: args.name,
      password_hash: passwordHash,
      is_root: args.isRoot ?? false,
      status: 'active',
      display_name: args.displayName ?? null,
      created_at: now,
      updated_at: now
    }
  });

  console.log('操作者已创建:');
  console.log(`  ID:       ${operator.id}`);
  console.log(`  用户名:   ${operator.username}`);
  console.log(`  角色:     ${operator.is_root ? 'root' : 'operator'}`);
  console.log(`  状态:     ${operator.status}`);
  if (operator.display_name) {
    console.log(`  显示名:   ${operator.display_name}`);
  }
};

const doList = async (prisma: PrismaClient, args: ParsedArgs): Promise<void> => {
  const limit = args.limit ?? 50;

  const operators = await prisma.operator.findMany({
    take: limit,
    orderBy: { created_at: 'desc' }
  });

  if (operators.length === 0) {
    console.log('没有找到操作者');
    return;
  }

  console.log(`操作者列表 (${operators.length} 个):`);
  for (const op of operators) {
    console.log(`  ${op.id}`);
    console.log(`    用户名: ${op.username}${op.is_root ? ' [root]' : ''}  |  状态: ${op.status}  |  创建: ${op.created_at}`);
    if (op.display_name) {
      console.log(`    显示名: ${op.display_name}`);
    }
  }
};

const doShow = async (prisma: PrismaClient, args: ParsedArgs): Promise<void> => {
  if (!args.id) {
    console.error('错误: 请指定操作者 ID (pnpm operator show <id>)');
    process.exitCode = 1;
    return;
  }

  const operator = await prisma.operator.findUnique({ where: { id: args.id } });
  if (!operator) {
    console.error(`错误: 操作者 ${args.id} 不存在`);
    process.exitCode = 1;
    return;
  }

  const identity = await prisma.identity.findUnique({ where: { id: operator.identity_id } });

  console.log('操作者详情:');
  console.log(`  ID:         ${operator.id}`);
  console.log(`  用户名:     ${operator.username}`);
  console.log(`  显示名:     ${operator.display_name ?? '(无)'}`);
  console.log(`  角色:       ${operator.is_root ? 'root' : 'operator'}`);
  console.log(`  状态:       ${operator.status}`);
  console.log(`  身份 ID:    ${operator.identity_id}`);
  console.log(`  身份类型:   ${identity?.type ?? 'N/A'}`);
  console.log(`  创建时间:   ${operator.created_at}`);
  console.log(`  更新时间:   ${operator.updated_at}`);
};

const doUpdate = async (prisma: PrismaClient, args: ParsedArgs): Promise<void> => {
  if (!args.id) {
    console.error('错误: 请指定操作者 ID (pnpm operator update <id>)');
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.operator.findUnique({ where: { id: args.id } });
  if (!existing) {
    console.error(`错误: 操作者 ${args.id} 不存在`);
    process.exitCode = 1;
    return;
  }

  const data: Record<string, unknown> = { updated_at: BigInt(Date.now()) };

  if (args.password) {
    validatePassword(args.password);
    data.password_hash = await hashPassword(args.password);
  }

  if (args.displayName !== undefined) {
    data.display_name = args.displayName;
  }

  if (args.isRoot !== undefined) {
    data.is_root = args.isRoot;
  }

  if (args.status) {
    validateStatus(args.status);
    data.status = args.status;
  }

  if (Object.keys(data).length <= 1) {
    console.error('错误: 未指定要更新的字段。使用 --password / --display-name / --status / --root');
    process.exitCode = 1;
    return;
  }

  const updated = await prisma.operator.update({
    where: { id: args.id },
    data
  });

  console.log('操作者已更新:');
  console.log(`  ID:       ${updated.id}`);
  console.log(`  用户名:   ${updated.username}`);
  console.log(`  角色:     ${updated.is_root ? 'root' : 'operator'}`);
  console.log(`  状态:     ${updated.status}`);
};

const doDelete = async (prisma: PrismaClient, args: ParsedArgs): Promise<void> => {
  if (!args.id) {
    console.error('错误: 请指定操作者 ID (pnpm operator delete <id>)');
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.operator.findUnique({ where: { id: args.id } });
  if (!existing) {
    console.error(`错误: 操作者 ${args.id} 不存在`);
    process.exitCode = 1;
    return;
  }

  await prisma.operator.update({
    where: { id: args.id },
    data: { status: 'disabled', updated_at: BigInt(Date.now()) }
  });

  console.log(`操作者 ${args.id} (${existing.username}) 已禁用`);
};

const runCli = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.command) {
    printHelp();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const prisma = new PrismaClient();

  try {
    await prisma.$connect();

    switch (args.command) {
      case 'create':
        await doCreate(prisma, args);
        break;
      case 'list':
        await doList(prisma, args);
        break;
      case 'show':
        await doShow(prisma, args);
        break;
      case 'update':
        await doUpdate(prisma, args);
        break;
      case 'delete':
        await doDelete(prisma, args);
        break;
      default:
        console.error(`错误: 未知命令 "${args.command}"。使用 --help 查看帮助。`);
        process.exitCode = 1;
    }
  } catch (error) {
    console.error('错误:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

void runCli();
