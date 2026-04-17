import { randomUUID } from 'node:crypto';

import type { PluginInstallation, PluginListResponseData } from '@yidhras/contracts';

import { PLUGIN_ENABLE_ACK_REQUIRED_CODE, PLUGIN_ENABLE_WARNING_TEXT } from '../../plugins/contracts.js';
import { syncActivePackPluginRuntime } from '../../plugins/runtime.js';
import { assertPluginEnableAllowed,createPluginManagerService } from '../../plugins/service.js';
import { createPluginStore } from '../../plugins/store.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';

const createManager = (context: AppContext) => {
  const store = createPluginStore({ prisma: context.prisma });
  return createPluginManagerService(store);
};

const getEnableWarningConfig = (context: AppContext) => {
  return context.getPluginEnableWarningConfig?.() ?? {
    enabled: true,
    require_acknowledgement: true
  };
};

const getEnableWarningTextHash = async (): Promise<string> => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(PLUGIN_ENABLE_WARNING_TEXT).digest('hex');
};

export const getPackPluginEnableWarningSnapshot = async (context: AppContext) => {
  const config = getEnableWarningConfig(context);
  return {
    ...config,
    reminder_text: PLUGIN_ENABLE_WARNING_TEXT,
    reminder_text_hash: await getEnableWarningTextHash()
  };
};

export const listPackPluginInstallations = async (
  context: AppContext,
  packId: string
): Promise<PluginListResponseData> => {
  const store = createPluginStore({ prisma: context.prisma });
  const items = await store.listInstallationsByScope({
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
  context: AppContext,
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

export const disablePackPlugin = async (
  context: AppContext,
  installationId: string
): Promise<PluginInstallation> => {
  const manager = createManager(context);
  const installation = await manager.disableInstallation({
    installation_id: installationId,
    disabled_at: String(Date.now())
  });
  await syncActivePackPluginRuntime(context);
  return installation;
};

export const enablePackPlugin = async (
  context: AppContext,
  installationId: string,
  acknowledgement?: {
    reminder_text_hash: string;
    actor_id?: string;
    actor_label?: string;
  }
): Promise<PluginInstallation> => {
  const store = createPluginStore({ prisma: context.prisma });
  const manager = createManager(context);
  const installation = await store.getInstallationById(installationId);

  if (!installation) {
    throw new ApiError(404, 'PLUGIN_INSTALLATION_NOT_FOUND', 'Plugin installation not found', { installation_id: installationId });
  }

  assertPluginEnableAllowed(installation);

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

  await syncActivePackPluginRuntime(context);

  return enabledInstallation;
};
