import { randomUUID } from 'node:crypto';

import type { PluginInstallation, PluginListResponseData, PluginManifest } from '@yidhras/contracts';

import { getRuntimeConfig } from '../../../config/runtime_config.js';
import { PLUGIN_ENABLE_ACK_REQUIRED_CODE, PLUGIN_ENABLE_WARNING_TEXT } from '../../../plugins/contracts.js';
import { checkDependencies, checkReverseDependencies } from '../../../plugins/dependency_resolver.js';
import { assertPluginEnableAllowed, createPluginManagerService } from '../../../plugins/service.js';
import { ApiError } from '../../../utils/api_error.js';
import { createLogger } from '../../../utils/logger.js';
import type { DataContext, PortContext } from '../../context.js';
import { createPackScopedPluginRuntimeService } from '../pack/pack_scoped_plugin_runtime_service.js';

const refreshScopedPluginRuntime = async (context: DataContext & PortContext, packId: string | null | undefined): Promise<void> => {
  const normalizedPackId = typeof packId === 'string' ? packId.trim() : '';
  if (normalizedPackId.length === 0) {
    return;
  }

  await createPackScopedPluginRuntimeService(context).refreshPackRuntime(normalizedPackId);
};

const createManager = (context: DataContext & PortContext) => {
  return createPluginManagerService(context.repos.plugin);
};

const getEnableWarningConfig = (context: DataContext & PortContext) => {
  return context.getPluginEnableWarningConfig();
};

const getEnableWarningTextHash = async (): Promise<string> => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(PLUGIN_ENABLE_WARNING_TEXT).digest('hex');
};

export const getPackPluginEnableWarningSnapshot = async (context: DataContext & PortContext) => {
  const config = getEnableWarningConfig(context);
  return {
    ...config,
    reminder_text: PLUGIN_ENABLE_WARNING_TEXT,
    reminder_text_hash: await getEnableWarningTextHash()
  };
};

export const listPackPluginInstallations = async (
  context: DataContext & PortContext,
  packId: string
): Promise<PluginListResponseData> => {
  const items = await context.repos.plugin.listInstallationsByScope({
    scope_type: 'pack_local',
    scope_ref: packId
  });

  return {
    enable_warning: await getPackPluginEnableWarningSnapshot(context),
    pack_id: packId,
    items
  };
};

export const confirmPackPluginImport = async (
  context: DataContext & PortContext,
  installationId: string,
  grantedCapabilities?: string[]
): Promise<PluginInstallation> => {
  const manager = createManager(context);
  return manager.confirmInstallation({
    installation_id: installationId,
    granted_capabilities: grantedCapabilities,
    confirmed_at: String(Date.now())
  });
};

const buildDependencyContext = async (context: DataContext & PortContext, scopeRef?: string) => {
  const packLocal = scopeRef
    ? await context.repos.plugin.listInstallationsByScope({ scope_type: 'pack_local', scope_ref: scopeRef })
    : [];
  const global = await context.repos.plugin.listInstallationsByScope({ scope_type: 'global' });
  const enabledInstallations = [...packLocal, ...global].filter(i => i.lifecycle_state === 'enabled');

  const enabledManifests = new Map<string, PluginManifest>();
  for (const inst of enabledInstallations) {
    const artifact = await context.repos.plugin.getArtifactById(inst.artifact_id);
    if (artifact) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      enabledManifests.set(inst.installation_id, artifact.manifest_json as PluginManifest);
    }
  }

  return { enabledInstallations, enabledManifests };
};

export const disablePackPlugin = async (
  context: DataContext & PortContext,
  installationId: string
): Promise<PluginInstallation> => {
  const manager = createManager(context);
  const installation = await context.repos.plugin.getInstallationById(installationId);

  if (!installation) {
    throw new ApiError(404, 'PLUGIN_INSTALLATION_NOT_FOUND', 'Plugin installation not found', { installation_id: installationId });
  }

  const { enabledInstallations, enabledManifests } = await buildDependencyContext(
    context,
    installation.scope_ref
  );

  const dependents = checkReverseDependencies(
    installation.plugin_id,
    enabledInstallations,
    enabledManifests
  );

  if (dependents.length > 0) {
    const strictMode = getRuntimeConfig().plugins.dependency.strict;

    if (strictMode) {
      throw new ApiError(
        409,
        'PLUGIN_HAS_DEPENDENTS',
        'Cannot disable plugin: other enabled plugins depend on it',
        { plugin_id: installation.plugin_id, dependents }
      );
    }

    const log = createLogger('plugins');
    log.warn(
      `Disabling plugin "${installation.plugin_id}" which has active dependents: ${dependents.join(', ')}. ` +
      'Set plugins.dependency.strict to true to block this.'
    );
  }

  const disabled = await manager.disableInstallation({
    installation_id: installationId,
    disabled_at: String(Date.now())
  });

  await refreshScopedPluginRuntime(context, installation.scope_ref);

  return disabled;
};

export const enablePackPlugin = async (
  context: DataContext & PortContext,
  installationId: string,
  acknowledgement?: {
    reminder_text_hash: string;
    actor_id?: string;
    actor_label?: string;
  }
): Promise<PluginInstallation> => {
  const manager = createManager(context);
  const installation = await context.repos.plugin.getInstallationById(installationId);

  if (!installation) {
    throw new ApiError(404, 'PLUGIN_INSTALLATION_NOT_FOUND', 'Plugin installation not found', { installation_id: installationId });
  }

  assertPluginEnableAllowed(installation);

  // Check dependencies before enabling
  const artifact = await context.repos.plugin.getArtifactById(installation.artifact_id);
  if (artifact) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    const manifest = artifact.manifest_json as PluginManifest;
    const { enabledInstallations, enabledManifests } = await buildDependencyContext(
      context,
      installation.scope_ref
    );

    const depCheck = checkDependencies({
      installation,
      manifest,
      enabledInstallations,
      enabledManifests
    });

    if (!depCheck.satisfied) {
      const missing = [
        ...depCheck.missingHardDeps.map(d => `plugin:${d.plugin_id}`),
        ...depCheck.missingInterfaceDeps.map(d => `interface:${d.key}`)
      ];

      throw new ApiError(
        400,
        'PLUGIN_DEPENDENCIES_UNSATISFIED',
        `Cannot enable plugin: missing dependencies`,
        { plugin_id: installation.plugin_id, missing }
      );
    }
  }

  const warning = getEnableWarningConfig(context);
  if (warning.enabled && warning.require_acknowledgement) {
    if (!acknowledgement) {
      throw new ApiError(400, PLUGIN_ENABLE_ACK_REQUIRED_CODE, 'Plugin enable acknowledgement is required');
    }

    const enableWarning = await getPackPluginEnableWarningSnapshot(context);
    if (acknowledgement.reminder_text_hash !== enableWarning.reminder_text_hash) {
      throw new ApiError(400, 'PLUGIN_ENABLE_ACK_INVALID', 'Plugin enable acknowledgement hash does not match current warning text');
    }

    await manager.recordEnableAcknowledgement({
      acknowledgement_id: randomUUID(),
      installation_id: installation.installation_id,
      pack_id: installation.scope_ref ?? 'unknown-pack',
      channel: 'api',
      reminder_text_hash: acknowledgement.reminder_text_hash,
      acknowledged: true,
      actor_id: acknowledgement.actor_id,
      actor_label: acknowledgement.actor_label,
      created_at: String(Date.now())
    });
  }

  const enabledInstallation = await manager.enableInstallation({
    installation_id: installation.installation_id,
    granted_capabilities: installation.granted_capabilities,
    enabled_at: String(Date.now())
  });

  await refreshScopedPluginRuntime(context, installation.scope_ref);

  return enabledInstallation;
};
