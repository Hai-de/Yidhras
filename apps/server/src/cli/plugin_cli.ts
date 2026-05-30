import 'dotenv/config';

import { createHash, randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client'
import type { PluginManifest } from '@yidhras/contracts';

import { getRuntimeConfig } from '../config/runtime_config.js';
import { createPrismaClient } from '../db/client.js';
import { PLUGIN_ENABLE_WARNING_TEXT } from '../plugins/contracts.js';
import { checkDependencies, checkReverseDependencies } from '../plugins/dependency_resolver.js';
import { assertPluginEnableAllowed, createPluginManagerService } from '../plugins/service.js';
import { createPluginStore } from '../plugins/store.js';

const COMMANDS = ['list', 'confirm', 'enable', 'disable', 'reload'] as const;

interface ParsedArgs {
  command?: string;
  installationId?: string;
  pack?: string;
  server?: string;
  token?: string;
  yes?: boolean;
  json?: boolean;
  help?: boolean;
}

const parseArgs = (argv: string[]): ParsedArgs => {
  const parsed: ParsedArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--pack':
        parsed.pack = argv[++i]!;
        break;
      case '--server':
        parsed.server = argv[++i]!;
        break;
      case '--token':
        parsed.token = argv[++i]!;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--yes':
      case '-y':
        parsed.yes = true;
        break;
      default:
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
        if (COMMANDS.includes(arg as (typeof COMMANDS)[number])) {
          parsed.command = arg;
        } else if (!parsed.command) {
          parsed.command = arg;
        } else if (!parsed.installationId) {
          parsed.installationId = arg;
        }
    }
  }

  return parsed;
};

const printHelp = (): void => {
  console.log(`plugin — 插件管理

用法:
  pnpm plugin list [--pack <pack-ref>] [--json]
  pnpm plugin confirm <installation-id>
  pnpm plugin enable <installation-id> [--pack <pack-ref>] [--yes]
  pnpm plugin disable <installation-id> [--pack <pack-ref>] [--yes]
  pnpm plugin reload --pack <pack-id> --server <url> --token <operator-token>
  pnpm plugin --help

命令:
  list       列出插件安装状态
  confirm    确认插件导入
  enable     启用插件（含依赖检查）
  disable    禁用插件（含反向依赖检查）
  reload     通过正在运行的 server 显式重载 pack 插件 runtime

选项:
  --pack <pack-ref>     限定 pack 范围（默认全局）
  --server <url>        Server 地址；也可用 YIDHRAS_SERVER_URL
  --token <token>       Operator bearer token；也可用 YIDHRAS_OPERATOR_TOKEN
  --json                JSON 格式输出
  --yes, -y             跳过确认提示
`);
};

const getEnableWarningTextHash = (): string => {
  return createHash('sha256').update(PLUGIN_ENABLE_WARNING_TEXT).digest('hex');
};

// --- list ---

// Lightweight row type matching PluginInstallation table columns
interface PluginInstallationRow {
  installation_id: string;
  plugin_id: string;
  artifact_id: string;
  version: string;
  scope_type: string;
  scope_ref: string | null;
  lifecycle_state: string;
  requested_capabilities: string;
  granted_capabilities: string;
  trust_mode: string;
  confirmed_at: bigint | null;
  enabled_at: bigint | null;
  disabled_at: bigint | null;
  last_error: string | null;
}

const queryInstallations = async (
  prisma: PrismaClient,
  packRef?: string
): Promise<PluginInstallationRow[]> => {
  if (packRef) {
    return prisma.pluginInstallation.findMany({
      where: { scope_type: 'pack_local', scope_ref: packRef },
      orderBy: [{ plugin_id: 'asc' }, { installation_id: 'asc' }]
    });
  }

  return prisma.pluginInstallation.findMany({
    orderBy: [{ plugin_id: 'asc' }, { installation_id: 'asc' }]
  });
};

const STATE_ICONS: Record<string, string> = {
  enabled: '[+]',
  disabled: '[-]',
  pending_confirmation: '[?]',
  error: '[!]'
};

const doList = async (prisma: PrismaClient, args: ParsedArgs): Promise<void> => {
  const rows = await queryInstallations(prisma, args.pack);

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log('没有找到插件安装记录');
    return;
  }

  console.log(`插件列表 (${rows.length} 个):`);
  for (const row of rows) {
    const state = row.lifecycle_state;
    const icon = STATE_ICONS[state] ?? `[${state}]`;

    console.log(`  ${icon} ${row.plugin_id} (v${row.version})`);
    console.log(`     ID:       ${row.installation_id}`);
    console.log(`     状态:     ${state}`);
    console.log(`     范围:     ${row.scope_type}${row.scope_ref ? ` → ${row.scope_ref}` : ''}`);
    if (row.last_error) {
      console.log(`     错误:     ${row.last_error}`);
    }
  }
};

// --- confirm ---

const doConfirm = async (prisma: PrismaClient, args: ParsedArgs): Promise<void> => {
  if (!args.installationId) {
    console.error('错误: 请指定 installation ID (pnpm plugin confirm <installation-id>)');
    process.exitCode = 1;
    return;
  }

  const store = createPluginStore({ prisma });
  const manager = createPluginManagerService(store);

  const installation = await store.getInstallationById(args.installationId);
  if (!installation) {
    console.error(`错误: 安装记录 ${args.installationId} 不存在`);
    process.exitCode = 1;
    return;
  }

  const result = await manager.confirmInstallation({
    installation_id: args.installationId,
    confirmed_at: String(Date.now())
  });

  console.log('插件已确认导入:');
  console.log(`  ID:       ${result.installation_id}`);
  console.log(`  插件:     ${result.plugin_id} (${result.version})`);
  console.log(`  状态:     ${result.lifecycle_state}`);
  console.log(`  能力:     ${result.granted_capabilities.join(', ') || '(无)'}`);
};

// --- enable ---

const doEnable = async (prisma: PrismaClient, args: ParsedArgs): Promise<void> => {
  if (!args.installationId) {
    console.error('错误: 请指定 installation ID (pnpm plugin enable <installation-id>)');
    process.exitCode = 1;
    return;
  }

  const store = createPluginStore({ prisma });
  const manager = createPluginManagerService(store);

  const installation = await store.getInstallationById(args.installationId);
  if (!installation) {
    console.error(`错误: 安装记录 ${args.installationId} 不存在`);
    process.exitCode = 1;
    return;
  }

  try {
    assertPluginEnableAllowed(installation);
  } catch {
    console.error(`错误: 插件当前状态不允许启用 (${installation.lifecycle_state})`);
    process.exitCode = 1;
    return;
  }

  // Dependency check
  const artifact = await store.getArtifactById(installation.artifact_id);
  if (artifact) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    const manifest = artifact.manifest_json as PluginManifest;

    // Gather enabled installations and their manifests
    const scopeRef = installation.scope_ref ?? undefined;
    const packLocal = scopeRef
      ? (await store.listInstallationsByScope({ scope_type: 'pack_local', scope_ref: scopeRef })) ?? []
      : [];
    const global = (await store.listInstallationsByScope({ scope_type: 'global' })) ?? [];
    const enabledInstallations = [...packLocal, ...global].filter(
      i => i.lifecycle_state === 'enabled'
    );

    const enabledManifests = new Map<string, PluginManifest>();
    for (const inst of enabledInstallations) {
      const a = await store.getArtifactById(inst.artifact_id);
      if (a) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
        enabledManifests.set(inst.installation_id, a.manifest_json as PluginManifest);
      }
    }

    const depCheck = checkDependencies({
      installation,
      manifest,
      enabledInstallations,
      enabledManifests
    });

    if (!depCheck.satisfied) {
      const missing = [
        ...depCheck.missingHardDeps.map(d => `插件: ${d.plugin_id}${d.version ? ` (${d.version})` : ''}`),
        ...depCheck.missingInterfaceDeps.map(d => `接口: ${d.key}${d.version ? ` (${d.version})` : ''}`)
      ];

      console.error('错误: 依赖未满足，无法启用插件');
      for (const m of missing) {
        console.error(`  缺少: ${m}`);
      }
      process.exitCode = 1;
      return;
    }

    if (depCheck.missingOptionalDeps.length > 0) {
      console.log('警告: 以下可选依赖未满足（插件将以降级模式运行）:');
      for (const d of depCheck.missingOptionalDeps) {
        console.log(`  - ${d.key}${d.version ? ` (${d.version})` : ''}`);
      }
    }
  }

  // Enable warning acknowledgement
  const warning = getRuntimeConfig().plugins.enable_warning;
  if (warning.enabled && warning.require_acknowledgement) {
    if (!args.yes) {
      console.log(PLUGIN_ENABLE_WARNING_TEXT);
      console.log('\n使用 --yes 确认你已阅读并同意上述警告。');
      process.exitCode = 1;
      return;
    }

    const reminderHash = getEnableWarningTextHash();
    await manager.recordEnableAcknowledgement({
      acknowledgement_id: randomUUID(),
      installation_id: installation.installation_id,
      pack_id: installation.scope_ref ?? 'unknown-pack',
      channel: 'cli',
      reminder_text_hash: reminderHash,
      acknowledged: true,
      actor_id: undefined,
      actor_label: 'cli',
      created_at: String(Date.now())
    });
  }

  const result = await manager.enableInstallation({
    installation_id: args.installationId,
    enabled_at: String(Date.now())
  });

  console.log('插件已启用:');
  console.log(`  ID:       ${result.installation_id}`);
  console.log(`  插件:     ${result.plugin_id} (${result.version})`);
  console.log(`  状态:     ${result.lifecycle_state}`);
};

// --- disable ---

const doDisable = async (prisma: PrismaClient, args: ParsedArgs): Promise<void> => {
  if (!args.installationId) {
    console.error('错误: 请指定 installation ID (pnpm plugin disable <installation-id>)');
    process.exitCode = 1;
    return;
  }

  const store = createPluginStore({ prisma });
  const manager = createPluginManagerService(store);

  const installation = await store.getInstallationById(args.installationId);
  if (!installation) {
    console.error(`错误: 安装记录 ${args.installationId} 不存在`);
    process.exitCode = 1;
    return;
  }

  // Reverse dependency check
  const scopeRef = installation.scope_ref ?? undefined;
  const packLocal = scopeRef
    ? await store.listInstallationsByScope({ scope_type: 'pack_local', scope_ref: scopeRef })
    : [];
  const global = await store.listInstallationsByScope({ scope_type: 'global' });
  const enabledInstallations = [...packLocal, ...global].filter(
    i => i.lifecycle_state === 'enabled'
  );

  const enabledManifests = new Map<string, PluginManifest>();
  for (const inst of enabledInstallations) {
    const a = await store.getArtifactById(inst.artifact_id);
    if (a) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      enabledManifests.set(inst.installation_id, a.manifest_json as PluginManifest);
    }
  }

  const dependents = checkReverseDependencies(
    installation.plugin_id,
    enabledInstallations,
    enabledManifests
  );

  if (dependents.length > 0) {
    const strictMode = getRuntimeConfig().plugins.dependency.strict;

    if (strictMode) {
      console.error('错误: 以下已启用的插件依赖于此插件，无法禁用（strict 模式）:');
      for (const d of dependents) {
        console.error(`  - ${d}`);
      }
      console.error('\n提示: 可先禁用依赖者，或设置 plugins.dependency.strict 为 false');
      process.exitCode = 1;
      return;
    }

    console.log('警告: 以下已启用的插件依赖于此插件:');
    for (const d of dependents) {
      console.log(`  - ${d}`);
    }

    if (!args.yes) {
      console.log('\n使用 --yes 确认仍要禁用此插件。');
      process.exitCode = 1;
      return;
    }
  }

  const result = await manager.disableInstallation({
    installation_id: args.installationId,
    disabled_at: String(Date.now())
  });

  console.log('插件已禁用:');
  console.log(`  ID:       ${result.installation_id}`);
  console.log(`  插件:     ${result.plugin_id} (${result.version})`);
  console.log(`  状态:     ${result.lifecycle_state}`);
};

// --- entry ---

const runCli = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.command) {
    printHelp();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  if (args.command === 'reload') {
    await doReload(args);
    return;
  }

  const prisma = createPrismaClient();

  try {
    await prisma.$connect();

    switch (args.command) {
      case 'list':
        await doList(prisma, args);
        break;
      case 'confirm':
        await doConfirm(prisma, args);
        break;
      case 'enable':
        await doEnable(prisma, args);
        break;
      case 'disable':
        await doDisable(prisma, args);
        break;
      case 'reload':
        await doReload(args);
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

// --- reload ---

const doReload = async (args: ParsedArgs): Promise<void> => {
  if (!args.pack) {
    console.error('错误: 请通过 --pack <pack-id> 指定要重载的 pack');
    process.exitCode = 1;
    return;
  }

  const server = (args.server ?? process.env['YIDHRAS_SERVER_URL'] ?? '').trim().replace(/\/$/, '');
  const token = (args.token ?? process.env['YIDHRAS_OPERATOR_TOKEN'] ?? '').trim();

  if (!server) {
    console.error('错误: 请通过 --server <url> 或 YIDHRAS_SERVER_URL 指定正在运行的 server');
    process.exitCode = 1;
    return;
  }
  if (!token) {
    console.error('错误: 请通过 --token <operator-token> 或 YIDHRAS_OPERATOR_TOKEN 提供 operator token');
    process.exitCode = 1;
    return;
  }

  const parseReloadResponse = (text: string): { data?: { pack_id?: string; runtime_count?: number } } => {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || !('data' in parsed)) {
      return {};
    }
    const data = parsed.data;
    if (typeof data !== 'object' || data === null) {
      return {};
    }
    const packId = 'pack_id' in data && typeof data.pack_id === 'string' ? data.pack_id : undefined;
    const runtimeCount = 'runtime_count' in data && typeof data.runtime_count === 'number' ? data.runtime_count : undefined;
// @ts-expect-error -- EOPT strict mode
    return { data: { pack_id: packId, runtime_count: runtimeCount } };
  };

  const response = await fetch(`${server}/api/packs/${encodeURIComponent(args.pack)}/plugins/reload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  const text = await response.text();

  if (!response.ok) {
    console.error(`错误: reload 请求失败 (${response.status})`);
    console.error(text);
    process.exitCode = 1;
    return;
  }

  if (args.json) {
    console.log(text);
    return;
  }

  const parsed = parseReloadResponse(text);
  console.log('插件 runtime 已重载:');
  console.log(`  Pack:          ${parsed.data?.pack_id ?? args.pack}`);
  console.log(`  Runtime count: ${String(parsed.data?.runtime_count ?? 'unknown')}`);
};
