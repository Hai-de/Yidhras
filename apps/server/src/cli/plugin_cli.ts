import { createHash } from 'node:crypto';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import { PrismaClient } from '@prisma/client';
import type { PluginArtifact, PluginInstallation } from '@yidhras/contracts';

import type { AppContext, RuntimeLoopDiagnostics, StartupHealth } from '../app/context.js';
import { createRuntimeReadyGuard } from '../app/runtime/startup.js';
import {
  confirmPackPluginImport,
  disablePackPlugin,
  enablePackPlugin,
  listPackPluginInstallations
} from '../app/services/plugins.js';
import { ChronosEngine } from '../clock/engine.js';
import { getRuntimeConfig, getRuntimeConfigMetadata, getWorldPacksDir } from '../config/runtime_config.js';
import { PackManifestLoader, type WorldPack } from '../packs/manifest/loader.js';
import { PLUGIN_ENABLE_WARNING_TEXT } from '../plugins/contracts.js';
import {
  discoverPackLocalPlugins,
  type PluginDiscoveryFailure,
  type PluginDiscoveryResult
} from '../plugins/discovery.js';
import { createPluginStore } from '../plugins/store.js';
import type { PluginRegistrationResult } from '../plugins/types.js';
import { notifications } from '../utils/notifications.js';

export type PluginCliCommand =
  | 'list'
  | 'show'
  | 'confirm'
  | 'enable'
  | 'disable'
  | 'rescan'
  | 'logs'
  | 'why-not-enable';

export interface PluginCliOptions {
  command: PluginCliCommand;
  packId?: string;
  installationId?: string;
  pluginId?: string;
  state?: PluginInstallation['lifecycle_state'];
  capability?: string;
  grantedCapabilities?: string[];
  grantRequestedCapabilities?: boolean;
  acknowledgeRisk?: boolean;
  nonInteractive?: boolean;
  json?: boolean;
  limit?: number;
}

export interface PluginCliContext extends AppContext {
  prisma: PrismaClient;
}

export interface PackSelection {
  pack_id: string;
  pack_folder_name: string;
  pack: WorldPack;
}

interface PluginInstallationDetail {
  pack_id: string;
  installation: PluginInstallation;
  artifact: PluginArtifact | null;
}

interface PluginActivationLogEntry {
  activation_id: string;
  installation_id: string;
  pack_id: string;
  channel: string;
  result: string;
  started_at: string;
  finished_at?: string;
  loaded_server: boolean;
  loaded_web_manifest: boolean;
  error_message?: string;
}

interface PluginAcknowledgementLogEntry {
  acknowledgement_id: string;
  installation_id: string;
  pack_id: string;
  channel: string;
  reminder_text_hash: string;
  acknowledged: boolean;
  actor_id?: string;
  actor_label?: string;
  created_at: string;
}

export interface PluginLogSnapshot {
  pack_id: string;
  installation_id?: string;
  plugin_id?: string;
  activation_sessions: PluginActivationLogEntry[];
  acknowledgements: PluginAcknowledgementLogEntry[];
}

export interface PluginRescanSnapshot {
  pack_id: string;
  pack_folder_name: string;
  discovered_count: number;
  registration_count: number;
  failure_count: number;
  result: PluginDiscoveryResult;
}

export interface WhyNotEnableSnapshot {
  pack_id: string;
  installation_id: string;
  plugin_id: string;
  lifecycle_state: PluginInstallation['lifecycle_state'];
  installation_enable_allowed: boolean;
  cli_enable_ready: boolean;
  blockers: string[];
  requirements: string[];
  recommended_actions: string[];
  last_error?: string;
}

interface PluginCliDependencies {
  buildCliAppContext(packId: string): Promise<PluginCliContext>;
  resolvePackSelection(requestedPack?: string): PackSelection;
  discoverPackLocalPlugins(input: {
    prismaContext: { prisma: PrismaClient };
    pack: WorldPack;
    packRootDir: string;
  }): Promise<PluginDiscoveryResult>;
  promptForAcknowledgement(reminderText: string): Promise<boolean>;
  isInteractiveTerminal(): boolean;
  stdout(message: string): void;
  stderr(message: string): void;
}

const DEFAULT_RUNTIME_LOOP_DIAGNOSTICS: RuntimeLoopDiagnostics = {
  status: 'idle',
  in_flight: false,
  overlap_skipped_count: 0,
  iteration_count: 0,
  last_started_at: null,
  last_finished_at: null,
  last_duration_ms: null,
  last_error_message: null
};

const DEFAULT_LOG_LIMIT = 20;
const PLUGIN_ENABLE_WARNING_TEXT_HASH = createHash('sha256').update(PLUGIN_ENABLE_WARNING_TEXT).digest('hex');

const PLUGIN_LIFECYCLE_STATES: PluginInstallation['lifecycle_state'][] = [
  'discovered',
  'pending_confirmation',
  'confirmed_disabled',
  'enabled',
  'disabled',
  'upgrade_pending_confirmation',
  'error',
  'archived'
];

const CLI_USAGE_TEXT = [
  'Usage: pnpm --filter yidhras-server plugin -- <list|show|confirm|enable|disable|rescan|logs|audit|why-not-enable> [options]',
  'Commands:',
  '  list                                      列出当前 pack-local 插件',
  '  show --installation <id>                  查看单个插件 installation 详情',
  '  show --plugin <plugin-id>                 按 plugin id 查看详情',
  '  confirm --installation <id>               确认导入一个插件 installation',
  '  confirm --plugin <plugin-id>              按 plugin id 确认导入',
  '  enable --installation <id>                启用一个插件 installation',
  '  enable --plugin <plugin-id>               按 plugin id 启用',
  '  disable --installation <id>               禁用一个插件 installation',
  '  disable --plugin <plugin-id>              按 plugin id 禁用',
  '  rescan                                    重新扫描指定 pack 的 plugins 目录并导入/更新 installation',
  '  logs                                      查看 activation / acknowledgement 日志',
  '  audit                                     logs 的别名',
  '  why-not-enable                            诊断一个 installation 当前为什么不能启用',
  'Options:',
  '  --pack <pack-id|folder>                   指定 pack id 或目录名；默认使用 preferred world pack',
  '  --installation, --installation-id <id>    指定 installation id',
  '  --plugin <plugin-id>                      用 plugin id 定位当前 pack 中的 installation',
  '  --state <lifecycle-state>                 list 时按 lifecycle_state 过滤',
  '  --capability <capability-key>             list 时按 requested/granted capability 过滤',
  '  --grant <a,b,c|requested>                 confirm 时授予 capability；requested=授予 manifest 请求的全部能力',
  '  --limit <n>                               logs 输出条数上限，默认 20',
  '  --acknowledge-plugin-risk, --yes, -y      非交互模式下显式确认 trusted plugin 风险',
  '  --non-interactive                         禁止交互输入；缺少 acknowledgement 时 enable 会失败',
  '  --json, -j                                以 JSON 输出结果',
  '  --help, -h                                显示帮助',
  'Examples:',
  '  pnpm --filter yidhras-server plugin -- list --pack demo-pack',
  '  pnpm --filter yidhras-server plugin -- show --plugin plugin.alpha',
  '  pnpm --filter yidhras-server plugin -- confirm --plugin plugin.alpha --grant requested',
  '  pnpm --filter yidhras-server plugin -- enable --plugin plugin.alpha --yes --non-interactive',
  '  pnpm --filter yidhras-server plugin -- rescan --pack demo-pack',
  '  pnpm --filter yidhras-server plugin -- logs --plugin plugin.alpha --limit 10',
  '  pnpm --filter yidhras-server plugin -- list --state enabled --capability server.api_route.register',
  '  pnpm --filter yidhras-server plugin -- why-not-enable --installation <id> --pack demo-pack'
].join('\n');

const defaultDependencies: PluginCliDependencies = {
  buildCliAppContext: async (packId: string) => buildCliAppContext(packId),
  resolvePackSelection(requestedPack?: string) {
    return resolvePackSelection(requestedPack);
  },
  discoverPackLocalPlugins: async input => discoverPackLocalPlugins(input),
  promptForAcknowledgement: async (reminderText: string) => promptForAcknowledgement(reminderText),
  isInteractiveTerminal() {
    return Boolean(process.stdin.isTTY && process.stderr.isTTY);
  },
  stdout(message: string) {
    console.log(message);
  },
  stderr(message: string) {
    console.error(message);
  }
};

const parseGrantedCapabilities = (
  value: string | undefined
): Pick<PluginCliOptions, 'grantedCapabilities' | 'grantRequestedCapabilities'> => {
  if (!value || value.trim().length === 0) {
    throw new Error('Missing value for --grant <a,b,c|requested>');
  }

  if (value.trim() === 'requested') {
    return {
      grantRequestedCapabilities: true
    };
  }

  return {
    grantedCapabilities: value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  };
};

const parsePositiveInt = (value: string | undefined, optionName: string): number => {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing value for ${optionName} <n>`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${optionName} value: ${value}`);
  }

  return parsed;
};

const parseRequiredStringOption = (value: string | undefined, optionName: string): string => {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing value for ${optionName}`);
  }

  return value.trim();
};

const parseLifecycleState = (
  value: string | undefined
): PluginInstallation['lifecycle_state'] => {
  if (!value || value.trim().length === 0) {
    throw new Error('Missing value for --state <lifecycle-state>');
  }

  const normalized = value.trim() as PluginInstallation['lifecycle_state'];
  if (!PLUGIN_LIFECYCLE_STATES.includes(normalized)) {
    throw new Error(`Invalid --state value: ${value}`);
  }

  return normalized;
};

export const parsePluginCliArgs = (argv: string[]): PluginCliOptions => {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    throw new Error(CLI_USAGE_TEXT);
  }

  const rawCommand = argv[0];
  const command = (rawCommand === 'audit' ? 'logs' : rawCommand) as PluginCliCommand;
  if (!['list', 'show', 'confirm', 'enable', 'disable', 'rescan', 'logs', 'why-not-enable'].includes(command)) {
    throw new Error(`Unknown plugin CLI command: ${argv[0]}\n\n${CLI_USAGE_TEXT}`);
  }

  const options: PluginCliOptions = {
    command,
    limit: DEFAULT_LOG_LIMIT
  };

  for (let index = 1; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    switch (current) {
      case '--pack':
        options.packId = next;
        index += 1;
        break;
      case '--installation':
      case '--installation-id':
        options.installationId = next;
        index += 1;
        break;
      case '--plugin':
        options.pluginId = next;
        index += 1;
        break;
      case '--state':
        options.state = parseLifecycleState(next);
        index += 1;
        break;
      case '--capability':
        options.capability = parseRequiredStringOption(next, '--capability <capability-key>');
        index += 1;
        break;
      case '--grant': {
        const parsed = parseGrantedCapabilities(next);
        options.grantedCapabilities = parsed.grantedCapabilities;
        options.grantRequestedCapabilities = parsed.grantRequestedCapabilities;
        index += 1;
        break;
      }
      case '--limit':
        options.limit = parsePositiveInt(next, '--limit');
        index += 1;
        break;
      case '--acknowledge-plugin-risk':
      case '--yes':
      case '-y':
        options.acknowledgeRisk = true;
        break;
      case '--non-interactive':
        options.nonInteractive = true;
        break;
      case '--json':
      case '-j':
        options.json = true;
        break;
      default:
        if (current.startsWith('-')) {
          throw new Error(`Unknown option: ${current}\n\n${CLI_USAGE_TEXT}`);
        }
        throw new Error(`Unexpected positional argument: ${current}\n\n${CLI_USAGE_TEXT}`);
    }
  }

  return options;
};

export const formatPluginInstallationTable = (items: PluginInstallation[]): string => {
  const headers = {
    installation_id: 'INSTALLATION',
    plugin_id: 'PLUGIN',
    version: 'VERSION',
    lifecycle_state: 'STATE',
    granted_capabilities: 'GRANTED'
  };

  const rows = items.map(item => ({
    installation_id: item.installation_id,
    plugin_id: item.plugin_id,
    version: item.version,
    lifecycle_state: item.lifecycle_state,
    granted_capabilities: item.granted_capabilities.join(',') || 'none'
  }));

  const widths = {
    installation_id: Math.max(headers.installation_id.length, ...rows.map(row => row.installation_id.length)),
    plugin_id: Math.max(headers.plugin_id.length, ...rows.map(row => row.plugin_id.length)),
    version: Math.max(headers.version.length, ...rows.map(row => row.version.length)),
    lifecycle_state: Math.max(headers.lifecycle_state.length, ...rows.map(row => row.lifecycle_state.length)),
    granted_capabilities: Math.max(headers.granted_capabilities.length, ...rows.map(row => row.granted_capabilities.length))
  };

  const formatRow = (row: typeof rows[number] | typeof headers): string => {
    return [
      row.installation_id.padEnd(widths.installation_id),
      row.plugin_id.padEnd(widths.plugin_id),
      row.version.padEnd(widths.version),
      row.lifecycle_state.padEnd(widths.lifecycle_state),
      row.granted_capabilities.padEnd(widths.granted_capabilities)
    ].join('  ');
  };

  return [formatRow(headers), ...rows.map(formatRow)].join('\n');
};

const formatRegistrationTable = (items: PluginRegistrationResult[]): string => {
  const headers = {
    plugin_id: 'PLUGIN',
    version: 'VERSION',
    status: 'DISCOVERY_STATUS',
    installation_id: 'INSTALLATION',
    lifecycle_state: 'STATE'
  };

  const rows = items.map(item => ({
    plugin_id: item.installation.plugin_id,
    version: item.installation.version,
    status: item.status,
    installation_id: item.installation.installation_id,
    lifecycle_state: item.installation.lifecycle_state
  }));

  const widths = {
    plugin_id: Math.max(headers.plugin_id.length, ...rows.map(row => row.plugin_id.length)),
    version: Math.max(headers.version.length, ...rows.map(row => row.version.length)),
    status: Math.max(headers.status.length, ...rows.map(row => row.status.length)),
    installation_id: Math.max(headers.installation_id.length, ...rows.map(row => row.installation_id.length)),
    lifecycle_state: Math.max(headers.lifecycle_state.length, ...rows.map(row => row.lifecycle_state.length))
  };

  const formatRow = (row: typeof rows[number] | typeof headers): string => {
    return [
      row.plugin_id.padEnd(widths.plugin_id),
      row.version.padEnd(widths.version),
      row.status.padEnd(widths.status),
      row.installation_id.padEnd(widths.installation_id),
      row.lifecycle_state.padEnd(widths.lifecycle_state)
    ].join('  ');
  };

  return [formatRow(headers), ...rows.map(formatRow)].join('\n');
};

const formatFailureTable = (items: PluginDiscoveryFailure[]): string => {
  const headers = {
    manifest_path: 'MANIFEST_PATH',
    code: 'CODE',
    message: 'MESSAGE'
  };

  const rows = items.map(item => ({
    manifest_path: item.manifest_path,
    code: item.code,
    message: item.message
  }));

  const widths = {
    manifest_path: Math.max(headers.manifest_path.length, ...rows.map(row => row.manifest_path.length)),
    code: Math.max(headers.code.length, ...rows.map(row => row.code.length)),
    message: Math.max(headers.message.length, ...rows.map(row => row.message.length))
  };

  const formatRow = (row: typeof rows[number] | typeof headers): string => {
    return [
      row.manifest_path.padEnd(widths.manifest_path),
      row.code.padEnd(widths.code),
      row.message.padEnd(widths.message)
    ].join('  ');
  };

  return [formatRow(headers), ...rows.map(formatRow)].join('\n');
};

const formatActivationLogTable = (items: PluginActivationLogEntry[]): string => {
  const headers = {
    started_at: 'STARTED_AT',
    installation_id: 'INSTALLATION',
    channel: 'CHANNEL',
    result: 'RESULT',
    loaded: 'LOADED',
    error: 'ERROR'
  };

  const rows = items.map(item => ({
    started_at: item.started_at,
    installation_id: item.installation_id,
    channel: item.channel,
    result: item.result,
    loaded: `server=${item.loaded_server ? 'Y' : 'N'},web=${item.loaded_web_manifest ? 'Y' : 'N'}`,
    error: item.error_message ?? '-'
  }));

  const widths = {
    started_at: Math.max(headers.started_at.length, ...rows.map(row => row.started_at.length)),
    installation_id: Math.max(headers.installation_id.length, ...rows.map(row => row.installation_id.length)),
    channel: Math.max(headers.channel.length, ...rows.map(row => row.channel.length)),
    result: Math.max(headers.result.length, ...rows.map(row => row.result.length)),
    loaded: Math.max(headers.loaded.length, ...rows.map(row => row.loaded.length)),
    error: Math.max(headers.error.length, ...rows.map(row => row.error.length))
  };

  const formatRow = (row: typeof rows[number] | typeof headers): string => {
    return [
      row.started_at.padEnd(widths.started_at),
      row.installation_id.padEnd(widths.installation_id),
      row.channel.padEnd(widths.channel),
      row.result.padEnd(widths.result),
      row.loaded.padEnd(widths.loaded),
      row.error.padEnd(widths.error)
    ].join('  ');
  };

  return [formatRow(headers), ...rows.map(formatRow)].join('\n');
};

const formatAcknowledgementLogTable = (items: PluginAcknowledgementLogEntry[]): string => {
  const headers = {
    created_at: 'CREATED_AT',
    installation_id: 'INSTALLATION',
    channel: 'CHANNEL',
    acknowledged: 'ACK',
    actor_label: 'ACTOR',
    reminder_hash: 'REMINDER_HASH'
  };

  const rows = items.map(item => ({
    created_at: item.created_at,
    installation_id: item.installation_id,
    channel: item.channel,
    acknowledged: item.acknowledged ? 'yes' : 'no',
    actor_label: item.actor_label ?? '-',
    reminder_hash: item.reminder_text_hash.slice(0, 16)
  }));

  const widths = {
    created_at: Math.max(headers.created_at.length, ...rows.map(row => row.created_at.length)),
    installation_id: Math.max(headers.installation_id.length, ...rows.map(row => row.installation_id.length)),
    channel: Math.max(headers.channel.length, ...rows.map(row => row.channel.length)),
    acknowledged: Math.max(headers.acknowledged.length, ...rows.map(row => row.acknowledged.length)),
    actor_label: Math.max(headers.actor_label.length, ...rows.map(row => row.actor_label.length)),
    reminder_hash: Math.max(headers.reminder_hash.length, ...rows.map(row => row.reminder_hash.length))
  };

  const formatRow = (row: typeof rows[number] | typeof headers): string => {
    return [
      row.created_at.padEnd(widths.created_at),
      row.installation_id.padEnd(widths.installation_id),
      row.channel.padEnd(widths.channel),
      row.acknowledged.padEnd(widths.acknowledged),
      row.actor_label.padEnd(widths.actor_label),
      row.reminder_hash.padEnd(widths.reminder_hash)
    ].join('  ');
  };

  return [formatRow(headers), ...rows.map(formatRow)].join('\n');
};

const loadAvailablePackSelections = (): PackSelection[] => {
  const loader = new PackManifestLoader(getWorldPacksDir());
  return loader.listAvailablePacks().map(folderName => {
    const pack = loader.loadPack(folderName);
    return {
      pack_id: pack.metadata.id,
      pack_folder_name: folderName,
      pack
    } satisfies PackSelection;
  });
};

const resolvePackSelection = (requestedPack?: string): PackSelection => {
  const selections = loadAvailablePackSelections();
  if (selections.length === 0) {
    throw new Error('No available world packs found');
  }

  const requested = requestedPack?.trim();
  if (requested && requested.length > 0) {
    const directMatch = selections.find(item => item.pack_folder_name === requested || item.pack_id === requested);
    if (!directMatch) {
      throw new Error(`World pack not found: ${requested}`);
    }
    return directMatch;
  }

  const preferred = getRuntimeConfig().world.preferred_pack;
  return selections.find(item => item.pack_folder_name === preferred || item.pack_id === preferred) ?? selections[0];
};

const buildCliAppContext = async (packId: string): Promise<PluginCliContext> => {
  const prisma = new PrismaClient();
  await prisma.$connect();
  notifications.clear();

  const startupHealth: StartupHealth = {
    level: 'ok',
    checks: {
      db: true,
      world_pack_dir: true,
      world_pack_available: true
    },
    available_world_packs: [packId],
    errors: []
  };

  let runtimeReady = true;

  const sim = {
    prisma,
    clock: new ChronosEngine([], 0n),
    getCurrentTick: () => 0n,
    getAllTimes: () => [],
    getStepTicks: () => 1n,
    step: async () => {},
    getRuntimeSpeedSnapshot: () => ({
      mode: 'fixed' as const,
      source: 'default' as const,
      configured_step_ticks: null,
      override_step_ticks: null,
      override_since: null,
      effective_step_ticks: '1'
    }),
    getSqliteRuntimePragmaSnapshot: () => null,
    setRuntimeSpeedOverride: () => {},
    clearRuntimeSpeedOverride: () => {},
    getPacksDir: () => getWorldPacksDir(),
    getActivePack: () => ({
      metadata: {
        id: packId,
        name: packId,
        version: 'cli'
      }
    })
  } as unknown as AppContext['sim'];

  return {
    prisma,
    sim,
    notifications,
    startupHealth,
    getRuntimeReady: () => runtimeReady,
    setRuntimeReady: ready => {
      runtimeReady = ready;
    },
    getPaused: () => false,
    setPaused: () => {},
    getRuntimeLoopDiagnostics: () => DEFAULT_RUNTIME_LOOP_DIAGNOSTICS,
    setRuntimeLoopDiagnostics: () => {},
    getSqliteRuntimePragmas: () => null,
    getPluginEnableWarningConfig: () => ({
      enabled: getRuntimeConfig().plugins.enable_warning.enabled,
      require_acknowledgement: getRuntimeConfig().plugins.enable_warning.require_acknowledgement
    }),
    assertRuntimeReady: createRuntimeReadyGuard({
      getRuntimeReady: () => runtimeReady,
      startupHealth
    })
  };
};

const promptForAcknowledgement = async (reminderText: string): Promise<boolean> => {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr
  });

  try {
    process.stderr.write(`${reminderText}\n\n`);
    const answer = await rl.question('Type "enable" to acknowledge the warning and continue: ');
    return answer.trim().toLowerCase() === 'enable';
  } finally {
    rl.close();
  }
};

const getPluginStore = (context: PluginCliContext) => {
  return createPluginStore({ prisma: context.prisma });
};

const ensureTargetSelector = (options: PluginCliOptions): void => {
  if (!options.installationId && !options.pluginId) {
    throw new Error('Missing target selector: use --installation <installation-id> or --plugin <plugin-id>');
  }
};

const resolveTargetInstallation = async (
  context: PluginCliContext,
  packId: string,
  options: PluginCliOptions
): Promise<PluginInstallation> => {
  ensureTargetSelector(options);

  if (options.installationId) {
    const installation = await getPluginStore(context).getInstallationById(options.installationId);
    if (!installation) {
      throw new Error(`Plugin installation not found: ${options.installationId}`);
    }
    if (installation.scope_ref && installation.scope_ref !== packId) {
      throw new Error(
        `Installation ${installation.installation_id} belongs to pack ${installation.scope_ref}, not requested pack ${packId}`
      );
    }
    return installation;
  }

  const snapshot = await listPackPluginInstallations(context, packId);
  const installation = snapshot.items.find(item => item.plugin_id === options.pluginId);
  if (!installation) {
    throw new Error(`Plugin ${options.pluginId ?? 'unknown'} not found in pack ${packId}`);
  }

  return installation;
};

const loadInstallationDetail = async (
  context: PluginCliContext,
  packId: string,
  options: PluginCliOptions
): Promise<PluginInstallationDetail> => {
  const installation = await resolveTargetInstallation(context, packId, options);
  const artifact = await getPluginStore(context).getArtifactById(installation.artifact_id);

  return {
    pack_id: packId,
    installation,
    artifact
  };
};

const resolveGrantedCapabilities = async (
  context: PluginCliContext,
  packId: string,
  options: PluginCliOptions
): Promise<{ installation: PluginInstallation; grantedCapabilities: string[] | undefined }> => {
  const installation = await resolveTargetInstallation(context, packId, options);

  return {
    installation,
    grantedCapabilities: options.grantRequestedCapabilities
      ? installation.requested_capabilities
      : options.grantedCapabilities
  };
};

const ensureAcknowledgement = async (
  options: PluginCliOptions,
  context: AppContext,
  deps: PluginCliDependencies
): Promise<{ reminder_text_hash: string; actor_label: string } | undefined> => {
  const warning = context.getPluginEnableWarningConfig?.() ?? {
    enabled: true,
    require_acknowledgement: true
  };

  if (!warning.enabled) {
    return undefined;
  }

  if (!warning.require_acknowledgement) {
    deps.stderr(PLUGIN_ENABLE_WARNING_TEXT);
    return undefined;
  }

  if (options.acknowledgeRisk) {
    deps.stderr(PLUGIN_ENABLE_WARNING_TEXT);
    return {
      reminder_text_hash: PLUGIN_ENABLE_WARNING_TEXT_HASH,
      actor_label: 'cli'
    };
  }

  if (options.nonInteractive || !deps.isInteractiveTerminal()) {
    deps.stderr(PLUGIN_ENABLE_WARNING_TEXT);
    throw new Error('PLUGIN_ENABLE_ACK_REQUIRED: re-run with --acknowledge-plugin-risk/--yes or allow interactive confirmation');
  }

  deps.stderr(PLUGIN_ENABLE_WARNING_TEXT);
  const acknowledged = await deps.promptForAcknowledgement(PLUGIN_ENABLE_WARNING_TEXT);
  if (!acknowledged) {
    throw new Error('PLUGIN_ENABLE_ACK_REQUIRED: acknowledgement declined by operator');
  }

  return {
    reminder_text_hash: PLUGIN_ENABLE_WARNING_TEXT_HASH,
    actor_label: 'cli'
  };
};

const toJsonString = (value: unknown): string => JSON.stringify(value, null, 2);

const writeJson = (deps: PluginCliDependencies, payload: unknown): void => {
  deps.stdout(toJsonString(payload));
};

const writeHuman = (deps: PluginCliDependencies, message: string): void => {
  deps.stdout(message);
};

const renderInstallationDetail = (detail: PluginInstallationDetail): string => {
  const { installation, artifact } = detail;
  const manifest = artifact?.manifest_json as Record<string, unknown> | undefined;

  return [
    `pack_id: ${detail.pack_id}`,
    `installation_id: ${installation.installation_id}`,
    `plugin_id: ${installation.plugin_id}`,
    `version: ${installation.version}`,
    `lifecycle_state: ${installation.lifecycle_state}`,
    `scope: ${installation.scope_type}:${installation.scope_ref ?? 'n/a'}`,
    `trust_mode: ${installation.trust_mode}`,
    `requested_capabilities: ${installation.requested_capabilities.join(', ') || 'none'}`,
    `granted_capabilities: ${installation.granted_capabilities.join(', ') || 'none'}`,
    `confirmed_at: ${installation.confirmed_at ?? 'n/a'}`,
    `enabled_at: ${installation.enabled_at ?? 'n/a'}`,
    `disabled_at: ${installation.disabled_at ?? 'n/a'}`,
    `last_error: ${installation.last_error ?? 'n/a'}`,
    `artifact_id: ${installation.artifact_id}`,
    `artifact_checksum: ${artifact?.checksum ?? 'n/a'}`,
    `artifact_source_type: ${artifact?.source_type ?? 'n/a'}`,
    `artifact_source_path: ${artifact?.source_path ?? 'n/a'}`,
    `manifest_version: ${artifact?.manifest_version ?? 'n/a'}`,
    `manifest_summary: ${manifest ? Object.keys(manifest).join(', ') || 'empty' : 'n/a'}`
  ].join('\n');
};

const mapActivationLogEntry = (row: {
  activation_id: string;
  installation_id: string;
  pack_id: string;
  channel: string;
  result: string;
  started_at: bigint;
  finished_at: bigint | null;
  loaded_server: boolean;
  loaded_web_manifest: boolean;
  error_message: string | null;
}): PluginActivationLogEntry => ({
  activation_id: row.activation_id,
  installation_id: row.installation_id,
  pack_id: row.pack_id,
  channel: row.channel,
  result: row.result,
  started_at: row.started_at.toString(),
  finished_at: row.finished_at?.toString(),
  loaded_server: row.loaded_server,
  loaded_web_manifest: row.loaded_web_manifest,
  error_message: row.error_message ?? undefined
});

const mapAcknowledgementLogEntry = (row: {
  acknowledgement_id: string;
  installation_id: string;
  pack_id: string;
  channel: string;
  reminder_text_hash: string;
  acknowledged: boolean;
  actor_id: string | null;
  actor_label: string | null;
  created_at: bigint;
}): PluginAcknowledgementLogEntry => ({
  acknowledgement_id: row.acknowledgement_id,
  installation_id: row.installation_id,
  pack_id: row.pack_id,
  channel: row.channel,
  reminder_text_hash: row.reminder_text_hash,
  acknowledged: row.acknowledged,
  actor_id: row.actor_id ?? undefined,
  actor_label: row.actor_label ?? undefined,
  created_at: row.created_at.toString()
});

const loadPluginLogs = async (
  context: PluginCliContext,
  packId: string,
  options: PluginCliOptions
): Promise<PluginLogSnapshot> => {
  const installation = options.installationId || options.pluginId
    ? await resolveTargetInstallation(context, packId, options)
    : undefined;
  const take = options.limit ?? DEFAULT_LOG_LIMIT;

  const activationRows = await context.prisma.pluginActivationSession.findMany({
    where: {
      pack_id: packId,
      ...(installation ? { installation_id: installation.installation_id } : {})
    },
    orderBy: [{ started_at: 'desc' }, { activation_id: 'desc' }],
    take
  });

  const acknowledgementRows = await context.prisma.pluginEnableAcknowledgement.findMany({
    where: {
      pack_id: packId,
      ...(installation ? { installation_id: installation.installation_id } : {})
    },
    orderBy: [{ created_at: 'desc' }, { acknowledgement_id: 'desc' }],
    take
  });

  return {
    pack_id: packId,
    installation_id: installation?.installation_id,
    plugin_id: installation?.plugin_id,
    activation_sessions: activationRows.map(mapActivationLogEntry),
    acknowledgements: acknowledgementRows.map(mapAcknowledgementLogEntry)
  };
};

const filterInstallations = (
  items: PluginInstallation[],
  options: PluginCliOptions
): PluginInstallation[] => {
  return items.filter(item => {
    if (options.state && item.lifecycle_state !== options.state) {
      return false;
    }

    if (options.capability) {
      const capability = options.capability;
      const hasCapability = item.requested_capabilities.includes(capability) || item.granted_capabilities.includes(capability);
      if (!hasCapability) {
        return false;
      }
    }

    return true;
  });
};

const formatActiveListFilters = (options: PluginCliOptions): string => {
  const parts: string[] = [];
  if (options.state) {
    parts.push(`state=${options.state}`);
  }
  if (options.capability) {
    parts.push(`capability=${options.capability}`);
  }
  return parts.length > 0 ? ` | filters: ${parts.join(', ')}` : '';
};

const buildWhyNotEnableSnapshot = async (
  context: PluginCliContext,
  packId: string,
  options: PluginCliOptions,
  deps: PluginCliDependencies
): Promise<WhyNotEnableSnapshot> => {
  const installation = await resolveTargetInstallation(context, packId, options);
  const warning = context.getPluginEnableWarningConfig?.() ?? {
    enabled: true,
    require_acknowledgement: true
  };
  const installationEnableAllowed = installation.lifecycle_state === 'confirmed_disabled' || installation.lifecycle_state === 'disabled';
  const blockers: string[] = [];
  const requirements: string[] = [];
  const recommendedActions: string[] = [];

  if (!installationEnableAllowed) {
    blockers.push(`Lifecycle state ${installation.lifecycle_state} is not enable-able. Expected confirmed_disabled or disabled.`);
  }

  if (installation.lifecycle_state === 'pending_confirmation' || installation.lifecycle_state === 'upgrade_pending_confirmation') {
    recommendedActions.push('Confirm the plugin import first before enabling it.');
  }

  if (installation.lifecycle_state === 'enabled') {
    blockers.push('Plugin is already enabled.');
    recommendedActions.push('No action is required unless you intend to disable and re-enable it.');
  }

  if (installation.lifecycle_state === 'archived') {
    blockers.push('Plugin installation is archived.');
    recommendedActions.push('Rescan or re-import the plugin to create an active installation.');
  }

  if (installation.last_error) {
    blockers.push(`Last recorded error: ${installation.last_error}`);
    recommendedActions.push('Inspect the recorded error and resolve it before retrying enable.');
  }

  if (warning.enabled && warning.require_acknowledgement) {
    requirements.push('Explicit enable requires acknowledgement of the canonical trust lecture.');
    if (!options.acknowledgeRisk && (options.nonInteractive || !deps.isInteractiveTerminal())) {
      blockers.push('Current CLI invocation cannot satisfy acknowledgement: pass --yes/--acknowledge-plugin-risk or run interactively.');
      recommendedActions.push('Re-run enable with --yes in automation, or run it interactively and type "enable" when prompted.');
    }
  } else if (warning.enabled) {
    requirements.push('Enable warning text will be shown, but acknowledgement is not required by current config.');
  }

  if (recommendedActions.length === 0 && installationEnableAllowed) {
    recommendedActions.push('Enable should be allowed. Run the enable command directly.');
  }

  return {
    pack_id: packId,
    installation_id: installation.installation_id,
    plugin_id: installation.plugin_id,
    lifecycle_state: installation.lifecycle_state,
    installation_enable_allowed: installationEnableAllowed,
    cli_enable_ready: blockers.length === 0,
    blockers,
    requirements,
    recommended_actions: recommendedActions,
    last_error: installation.last_error
  };
};

const renderWhyNotEnableSnapshot = (snapshot: WhyNotEnableSnapshot): string => {
  return [
    `pack_id: ${snapshot.pack_id}`,
    `installation_id: ${snapshot.installation_id}`,
    `plugin_id: ${snapshot.plugin_id}`,
    `lifecycle_state: ${snapshot.lifecycle_state}`,
    `installation_enable_allowed: ${snapshot.installation_enable_allowed ? 'yes' : 'no'}`,
    `cli_enable_ready: ${snapshot.cli_enable_ready ? 'yes' : 'no'}`,
    `blockers: ${snapshot.blockers.length > 0 ? snapshot.blockers.join(' | ') : 'none'}`,
    `requirements: ${snapshot.requirements.length > 0 ? snapshot.requirements.join(' | ') : 'none'}`,
    `recommended_actions: ${snapshot.recommended_actions.join(' | ')}`,
    `last_error: ${snapshot.last_error ?? 'n/a'}`
  ].join('\n');
};

const printListResult = async (
  context: PluginCliContext,
  packId: string,
  options: PluginCliOptions,
  deps: PluginCliDependencies
): Promise<void> => {
  const snapshot = await listPackPluginInstallations(context, packId);
  const filteredItems = filterInstallations(snapshot.items, options);

  if (options.json) {
    writeJson(deps, {
      ...snapshot,
      items: filteredItems
    });
    return;
  }

  if (snapshot.items.length === 0) {
    writeHuman(deps, `[plugin-cli] No plugin installations found for pack ${packId}${formatActiveListFilters(options)}`);
    return;
  }

  if (filteredItems.length === 0) {
    writeHuman(
      deps,
      `[plugin-cli] No plugin installations matched for pack ${packId}${formatActiveListFilters(options)}`
    );
    return;
  }

  writeHuman(
    deps,
    `[plugin-cli] Pack ${packId} plugin installations (${filteredItems.length}/${snapshot.items.length})${formatActiveListFilters(options)}`
  );
  writeHuman(deps, formatPluginInstallationTable(filteredItems));
};

const printShowResult = async (
  context: PluginCliContext,
  packId: string,
  options: PluginCliOptions,
  deps: PluginCliDependencies
): Promise<void> => {
  const detail = await loadInstallationDetail(context, packId, options);

  if (options.json) {
    writeJson(deps, detail);
    return;
  }

  writeHuman(deps, renderInstallationDetail(detail));
};

const printOperationResult = (
  action: 'confirmed' | 'enabled' | 'disabled',
  packId: string,
  installation: PluginInstallation,
  options: PluginCliOptions,
  deps: PluginCliDependencies
): void => {
  const payload = {
    acknowledged: true,
    pack_id: packId,
    installation
  };

  if (options.json) {
    writeJson(deps, payload);
    return;
  }

  writeHuman(
    deps,
    `[plugin-cli] ${action} ${installation.installation_id} (${installation.plugin_id}@${installation.version}) -> ${installation.lifecycle_state}`
  );
};

const printRescanResult = (snapshot: PluginRescanSnapshot, options: PluginCliOptions, deps: PluginCliDependencies): void => {
  if (options.json) {
    writeJson(deps, snapshot);
    return;
  }

  writeHuman(
    deps,
    `[plugin-cli] Rescan completed for pack ${snapshot.pack_id} (${snapshot.pack_folder_name}) | discovered=${String(snapshot.discovered_count)} | registrations=${String(snapshot.registration_count)} | failures=${String(snapshot.failure_count)}`
  );

  if (snapshot.result.registrations.length > 0) {
    writeHuman(deps, '');
    writeHuman(deps, formatRegistrationTable(snapshot.result.registrations));
  }

  if (snapshot.result.failures.length > 0) {
    writeHuman(deps, '');
    writeHuman(deps, formatFailureTable(snapshot.result.failures));
  }
};

const printLogResult = (snapshot: PluginLogSnapshot, options: PluginCliOptions, deps: PluginCliDependencies): void => {
  if (options.json) {
    writeJson(deps, snapshot);
    return;
  }

  const targetLabel = snapshot.installation_id
    ? `installation=${snapshot.installation_id}${snapshot.plugin_id ? ` plugin=${snapshot.plugin_id}` : ''}`
    : 'pack scope';

  writeHuman(
    deps,
    `[plugin-cli] Logs for pack ${snapshot.pack_id} (${targetLabel}) | activation_sessions=${String(snapshot.activation_sessions.length)} | acknowledgements=${String(snapshot.acknowledgements.length)}`
  );

  writeHuman(deps, '');
  writeHuman(deps, 'Activation sessions');
  if (snapshot.activation_sessions.length === 0) {
    writeHuman(deps, '(none)');
  } else {
    writeHuman(deps, formatActivationLogTable(snapshot.activation_sessions));
  }

  writeHuman(deps, '');
  writeHuman(deps, 'Enable acknowledgements');
  if (snapshot.acknowledgements.length === 0) {
    writeHuman(deps, '(none)');
  } else {
    writeHuman(deps, formatAcknowledgementLogTable(snapshot.acknowledgements));
  }
};

const printWhyNotEnableResult = async (
  context: PluginCliContext,
  packId: string,
  options: PluginCliOptions,
  deps: PluginCliDependencies
): Promise<void> => {
  const snapshot = await buildWhyNotEnableSnapshot(context, packId, options, deps);
  if (options.json) {
    writeJson(deps, snapshot);
    return;
  }
  writeHuman(deps, renderWhyNotEnableSnapshot(snapshot));
};

export const runPluginCli = async (
  argv: string[],
  dependencies: Partial<PluginCliDependencies> = {}
): Promise<void> => {
  const deps: PluginCliDependencies = {
    ...defaultDependencies,
    ...dependencies
  };

  const rawArgs = argv[0] === '--' ? argv.slice(1) : argv;
  const options = parsePluginCliArgs(rawArgs);
  const selection = deps.resolvePackSelection(options.packId);
  const context = await deps.buildCliAppContext(selection.pack_id);

  try {
    switch (options.command) {
      case 'list':
        await printListResult(context, selection.pack_id, options, deps);
        break;
      case 'show':
        await printShowResult(context, selection.pack_id, options, deps);
        break;
      case 'confirm': {
        const { installation, grantedCapabilities } = await resolveGrantedCapabilities(context, selection.pack_id, options);
        const confirmed = await confirmPackPluginImport(context, installation.installation_id, grantedCapabilities);
        printOperationResult('confirmed', selection.pack_id, confirmed, options, deps);
        break;
      }
      case 'enable': {
        const installation = await resolveTargetInstallation(context, selection.pack_id, options);
        const acknowledgement = await ensureAcknowledgement(options, context, deps);
        const enabled = await enablePackPlugin(context, installation.installation_id, acknowledgement);
        printOperationResult('enabled', selection.pack_id, enabled, options, deps);
        break;
      }
      case 'disable': {
        const installation = await resolveTargetInstallation(context, selection.pack_id, options);
        const disabled = await disablePackPlugin(context, installation.installation_id);
        printOperationResult('disabled', selection.pack_id, disabled, options, deps);
        break;
      }
      case 'rescan': {
        const result = await deps.discoverPackLocalPlugins({
          prismaContext: { prisma: context.prisma },
          pack: selection.pack,
          packRootDir: path.join(getWorldPacksDir(), selection.pack_folder_name)
        });
        printRescanResult(
          {
            pack_id: selection.pack_id,
            pack_folder_name: selection.pack_folder_name,
            discovered_count: result.discovered.length,
            registration_count: result.registrations.length,
            failure_count: result.failures.length,
            result
          },
          options,
          deps
        );
        break;
      }
      case 'logs': {
        const snapshot = await loadPluginLogs(context, selection.pack_id, options);
        printLogResult(snapshot, options, deps);
        break;
      }
      case 'why-not-enable': {
        await printWhyNotEnableResult(context, selection.pack_id, options, deps);
        break;
      }
    }
  } finally {
    await context.prisma.$disconnect();
  }
};

export const shouldRunPluginCli = (argv: string[] = process.argv): boolean => {
  const entry = argv[1] ?? '';
  return /plugin_cli\.(?:ts|js|mjs|cjs)$/.test(entry);
};

if (shouldRunPluginCli()) {
  void runPluginCli(process.argv.slice(2)).catch(error => {
    const metadata = getRuntimeConfigMetadata();
    console.error(`[plugin-cli] ${metadata.activeEnv} ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
