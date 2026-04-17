import type { PluginInstallation } from '@yidhras/contracts';
import { describe, expect, it, vi } from 'vitest';

import * as pluginService from '../../src/app/services/plugins.js';
import type {
  PluginCliContext,
  PluginLogSnapshot,
  PluginRescanSnapshot,
  WhyNotEnableSnapshot
} from '../../src/cli/plugin_cli.js';
import { formatPluginInstallationTable, parsePluginCliArgs, runPluginCli } from '../../src/cli/plugin_cli.js';
import type { PluginDiscoveryResult } from '../../src/plugins/discovery.js';

const createInstallation = (overrides: Partial<PluginInstallation> = {}): PluginInstallation => ({
  installation_id: 'installation-1',
  plugin_id: 'plugin.alpha',
  artifact_id: 'artifact-1',
  version: '0.1.0',
  scope_type: 'pack_local',
  scope_ref: 'world-pack-alpha',
  lifecycle_state: 'pending_confirmation',
  requested_capabilities: ['server.context_source.register'],
  granted_capabilities: [],
  trust_mode: 'trusted',
  ...overrides
});

const createCliContext = (): PluginCliContext => ({
  prisma: {
    $disconnect: vi.fn().mockResolvedValue(undefined),
    pluginInstallation: {
      findUnique: vi.fn(async ({ where }: { where: { installation_id: string } }) => {
        if (where.installation_id !== 'installation-1') {
          return null;
        }

        return {
          installation_id: 'installation-1',
          plugin_id: 'plugin.alpha',
          artifact_id: 'artifact-1',
          version: '0.1.0',
          scope_type: 'pack_local',
          scope_ref: 'world-pack-alpha',
          lifecycle_state: 'pending_confirmation',
          requested_capabilities: JSON.stringify(['server.context_source.register']),
          granted_capabilities: JSON.stringify([]),
          trust_mode: 'trusted',
          confirmed_at: null,
          enabled_at: null,
          disabled_at: null,
          last_error: null
        };
      }),
      findMany: vi.fn(async () => [])
    },
    pluginArtifact: {
      findUnique: vi.fn(async () => ({
        artifact_id: 'artifact-1',
        plugin_id: 'plugin.alpha',
        version: '0.1.0',
        manifest_version: 'plugin/v1',
        source_type: 'bundled_by_pack',
        source_pack_id: 'world-pack-alpha',
        source_path: 'data/world_packs/world-pack-alpha/plugins/plugin.alpha',
        checksum: 'sha256:test',
        manifest_json: {
          manifest_version: 'plugin/v1',
          id: 'plugin.alpha',
          name: 'Plugin Alpha',
          version: '0.1.0',
          kind: 'operator',
          entrypoints: {
            server: {
              runtime: 'node_esm',
              dist: 'dist/server.js'
            }
          },
          compatibility: {
            yidhras: '>=0.5.0',
            pack_id: 'world-pack-alpha'
          },
          requested_capabilities: ['server.context_source.register'],
          contributions: {
            server: {
              context_sources: [],
              prompt_workflow_steps: [],
              intent_grounders: [],
              pack_projections: [],
              api_routes: []
            },
            web: {
              panels: [],
              routes: [],
              menu_items: []
            }
          }
        },
        imported_at: BigInt(1000)
      }))
    },
    pluginActivationSession: {
      findMany: vi.fn(async () => [])
    },
    pluginEnableAcknowledgement: {
      findMany: vi.fn(async () => [])
    }
  } as unknown as PluginCliContext['prisma'],
  sim: {
    getActivePack: () => ({ metadata: { id: 'world-pack-alpha' } })
  } as PluginCliContext['sim'],
  notifications: {
    push: vi.fn(),
    getMessages: vi.fn(() => []),
    clear: vi.fn()
  },
  startupHealth: {
    level: 'ok',
    checks: {
      db: true,
      world_pack_dir: true,
      world_pack_available: true
    },
    available_world_packs: ['world-pack-alpha'],
    errors: []
  },
  getRuntimeReady: () => true,
  setRuntimeReady: vi.fn(),
  getPaused: () => false,
  setPaused: vi.fn(),
  getRuntimeLoopDiagnostics: vi.fn(),
  setRuntimeLoopDiagnostics: vi.fn(),
  getSqliteRuntimePragmas: vi.fn(() => null),
  getPluginEnableWarningConfig: () => ({
    enabled: true,
    require_acknowledgement: true
  }),
  assertRuntimeReady: vi.fn()
});

const defaultPackSelection = {
  pack_id: 'world-pack-alpha',
  pack_folder_name: 'world-pack-alpha',
  pack: {
    metadata: {
      id: 'world-pack-alpha',
      name: 'World Pack Alpha',
      version: '0.1.0'
    }
  }
};

describe('plugin cli', () => {
  it('parses show/json/yes options', () => {
    expect(parsePluginCliArgs(['show', '--plugin', 'plugin.alpha', '--json', '--yes'])).toEqual({
      command: 'show',
      pluginId: 'plugin.alpha',
      json: true,
      acknowledgeRisk: true,
      limit: 20
    });
  });

  it('parses logs alias and limit', () => {
    expect(parsePluginCliArgs(['audit', '--plugin', 'plugin.alpha', '--limit', '5'])).toEqual({
      command: 'logs',
      pluginId: 'plugin.alpha',
      limit: 5
    });
  });

  it('parses list filters and why-not-enable command', () => {
    expect(parsePluginCliArgs(['list', '--state', 'enabled', '--capability', 'server.api_route.register'])).toEqual({
      command: 'list',
      state: 'enabled',
      capability: 'server.api_route.register',
      limit: 20
    });

    expect(parsePluginCliArgs(['why-not-enable', '--installation', 'installation-1'])).toEqual({ command: 'why-not-enable', installationId: 'installation-1', limit: 20 });
  });

  it('formats installation table for human output', () => {
    const table = formatPluginInstallationTable([
      createInstallation(),
      createInstallation({
        installation_id: 'installation-2',
        plugin_id: 'plugin.beta',
        granted_capabilities: ['server.api_route.register']
      })
    ]);

    expect(table).toContain('INSTALLATION');
    expect(table).toContain('plugin.alpha');
    expect(table).toContain('plugin.beta');
    expect(table).toContain('server.api_route.register');
  });

  it('renders show command as json', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    await runPluginCli(['show', '--installation', 'installation-1', '--pack', 'world-pack-alpha', '--json'], {
      buildCliAppContext: async () => createCliContext(),
      resolvePackSelection: () => defaultPackSelection,
      stdout,
      stderr
    });

    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(stdout.mock.calls[0][0] as string) as {
      pack_id: string;
      installation: PluginInstallation;
      artifact: { checksum: string };
    };
    expect(payload.pack_id).toBe('world-pack-alpha');
    expect(payload.installation.plugin_id).toBe('plugin.alpha');
    expect(payload.artifact.checksum).toBe('sha256:test');
  });

  it('requires acknowledgement in non-interactive enable flow', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    await expect(
      runPluginCli(['enable', '--installation', 'installation-1', '--pack', 'world-pack-alpha', '--non-interactive'], {
        buildCliAppContext: async () => createCliContext(),
        resolvePackSelection: () => defaultPackSelection,
        stdout,
        stderr,
        promptForAcknowledgement: async () => true
      })
    ).rejects.toThrow(/PLUGIN_ENABLE_ACK_REQUIRED/);
  });

  it('allows grant=requested during confirm flow', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const confirmSpy = vi
      .spyOn(pluginService, 'confirmPackPluginImport')
      .mockImplementation(async (_context, _installationId, grantedCapabilities) => {
        return createInstallation({ granted_capabilities: grantedCapabilities ?? [] });
      });

    try {
      await runPluginCli(
        ['confirm', '--installation', 'installation-1', '--pack', 'world-pack-alpha', '--grant', 'requested', '--json'],
        {
          buildCliAppContext: async () => createCliContext(),
          resolvePackSelection: () => defaultPackSelection,
          stdout,
          stderr
        }
      );

      expect(stderr).not.toHaveBeenCalled();
      const payload = JSON.parse(stdout.mock.calls[0][0] as string) as {
        installation: PluginInstallation;
      };
      expect(payload.installation.installation_id).toBe('installation-1');
      expect(payload.installation.granted_capabilities).toEqual(['server.context_source.register']);
      expect(confirmSpy).toHaveBeenCalledWith(expect.anything(), 'installation-1', ['server.context_source.register']);
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('supports interactive acknowledgement when prompt resolves true', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const enableSpy = vi.spyOn(pluginService, 'enablePackPlugin').mockImplementation(async () => {
      return createInstallation({ lifecycle_state: 'enabled', enabled_at: '2000' });
    });

    try {
      await runPluginCli(['enable', '--installation', 'installation-1', '--pack', 'world-pack-alpha'], {
        buildCliAppContext: async () => createCliContext(),
        resolvePackSelection: () => defaultPackSelection,
        stdout,
        stderr,
        isInteractiveTerminal: () => true,
        promptForAcknowledgement: async () => true
      });

      expect(enableSpy).toHaveBeenCalledWith(
        expect.anything(),
        'installation-1',
        expect.objectContaining({
          actor_label: 'cli'
        })
      );
      expect(stderr).toHaveBeenCalled();
    } finally {
      enableSpy.mockRestore();
    }
  });

  it('supports rescan command with json output', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const discoveryResult: PluginDiscoveryResult = {
      discovered: [
        {
          plugin_dir_name: 'plugin.alpha',
          plugin_dir_path: 'data/world_packs/world-pack-alpha/plugins/plugin.alpha',
          manifest_path: 'data/world_packs/world-pack-alpha/plugins/plugin.alpha/plugin.manifest.yaml'
        }
      ],
      registrations: [
        {
          artifact: {
            artifact_id: 'artifact-1',
            plugin_id: 'plugin.alpha',
            version: '0.1.0',
            manifest_version: 'plugin/v1',
            source_type: 'bundled_by_pack',
            source_pack_id: 'world-pack-alpha',
            source_path: 'data/world_packs/world-pack-alpha/plugins/plugin.alpha',
            checksum: 'sha256:test',
            manifest_json: {},
            imported_at: '1000'
          },
          installation: createInstallation(),
          status: 'created'
        }
      ],
      failures: []
    };

    await runPluginCli(['rescan', '--pack', 'world-pack-alpha', '--json'], {
      buildCliAppContext: async () => createCliContext(),
      resolvePackSelection: () => defaultPackSelection,
      discoverPackLocalPlugins: async () => discoveryResult,
      stdout,
      stderr
    });

    expect(stderr).not.toHaveBeenCalled();
    const payload = JSON.parse(stdout.mock.calls[0][0] as string) as PluginRescanSnapshot;
    expect(payload.pack_id).toBe('world-pack-alpha');
    expect(payload.discovered_count).toBe(1);
    expect(payload.registration_count).toBe(1);
  });

  it('filters list output by state and capability', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const listSpy = vi.spyOn(pluginService, 'listPackPluginInstallations').mockResolvedValue({
      pack_id: 'world-pack-alpha',
      items: [
        createInstallation({
          installation_id: 'installation-enabled',
          plugin_id: 'plugin.enabled',
          lifecycle_state: 'enabled',
          granted_capabilities: ['server.api_route.register']
        }),
        createInstallation({
          installation_id: 'installation-disabled',
          plugin_id: 'plugin.disabled',
          lifecycle_state: 'disabled',
          granted_capabilities: []
        })
      ]
    });

    try {
      await runPluginCli(['list', '--pack', 'world-pack-alpha', '--state', 'enabled', '--capability', 'server.api_route.register', '--json'], {
        buildCliAppContext: async () => createCliContext(),
        resolvePackSelection: () => defaultPackSelection,
        stdout,
        stderr
      });

      expect(stderr).not.toHaveBeenCalled();
      const payload = JSON.parse(stdout.mock.calls[0][0] as string) as {
        items: PluginInstallation[];
      };
      expect(payload.items).toHaveLength(1);
      expect(payload.items[0]?.plugin_id).toBe('plugin.enabled');
    } finally {
      listSpy.mockRestore();
    }
  });

  it('supports logs command with installation filter', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const context = createCliContext();
    const activationRows = [
      {
        activation_id: 'act-1',
        installation_id: 'installation-1',
        pack_id: 'world-pack-alpha',
        channel: 'cli_enable',
        result: 'success',
        started_at: BigInt(1000),
        finished_at: BigInt(1001),
        loaded_server: true,
        loaded_web_manifest: false,
        error_message: null
      }
    ];
    const acknowledgementRows = [
      {
        acknowledgement_id: 'ack-1',
        installation_id: 'installation-1',
        pack_id: 'world-pack-alpha',
        channel: 'cli',
        reminder_text_hash: '1234567890abcdef1234567890abcdef',
        acknowledged: true,
        actor_id: null,
        actor_label: 'cli',
        created_at: BigInt(1000)
      }
    ];
    const activationFindMany = context.prisma.pluginActivationSession.findMany as unknown as ReturnType<typeof vi.fn>;
    const acknowledgementFindMany = context.prisma.pluginEnableAcknowledgement.findMany as unknown as ReturnType<typeof vi.fn>;
    activationFindMany.mockResolvedValue(activationRows);
    acknowledgementFindMany.mockResolvedValue(acknowledgementRows);

    await runPluginCli(['logs', '--installation', 'installation-1', '--pack', 'world-pack-alpha', '--json'], {
      buildCliAppContext: async () => context,
      resolvePackSelection: () => defaultPackSelection,
      stdout,
      stderr
    });

    expect(stderr).not.toHaveBeenCalled();
    const payload = JSON.parse(stdout.mock.calls[0][0] as string) as PluginLogSnapshot;

    expect(payload.installation_id).toBe('installation-1');
    expect(payload.activation_sessions[0]?.activation_id).toBe('act-1');
    expect(payload.acknowledgements[0]?.acknowledgement_id).toBe('ack-1');
  });

  it('explains why a plugin cannot currently be enabled', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    await runPluginCli(['why-not-enable', '--installation', 'installation-1', '--pack', 'world-pack-alpha', '--non-interactive', '--json'], {
      buildCliAppContext: async () => createCliContext(),
      resolvePackSelection: () => defaultPackSelection,
      stdout,
      stderr
    });

    expect(stderr).not.toHaveBeenCalled();
    const payload = JSON.parse(stdout.mock.calls[0][0] as string) as WhyNotEnableSnapshot;
    expect(payload.installation_id).toBe('installation-1');
    expect(payload.cli_enable_ready).toBe(false);
    expect(payload.blockers.some(item => item.includes('pending_confirmation'))).toBe(true);
    expect(payload.recommended_actions.some(item => item.includes('Confirm the plugin import first'))).toBe(true);
  });
});
