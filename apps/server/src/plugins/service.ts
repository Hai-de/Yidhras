import { createHash, randomUUID } from 'node:crypto';

import type { PluginActivationSession, PluginEnableAcknowledgement, PluginInstallation, PluginManifest } from '@yidhras/contracts';

import { ApiError } from '../utils/api_error.js';
import {
  parsePluginActivationSession,
  parsePluginEnableAcknowledgement,
  parsePluginInstallation,
  PLUGIN_ENABLE_ACK_REQUIRED_CODE,
  TRUSTED_PLUGIN_TRUST_MODE
} from './contracts.js';
import type {
  PluginEnableAcknowledgementCreateInput,
  PluginManagerService,
  PluginStore
} from './types.js';

const assertPackLocalScope = (scopeType: PluginInstallation['scope_type']): void => {
  if (scopeType !== 'pack_local') {
    throw new ApiError(400, 'PLUGIN_SCOPE_UNSUPPORTED', 'Only pack_local plugin scope is supported in the current phase', {
      scope_type: scopeType
    });
  }
};

const assertLifecycleTransition = (
  previousState: PluginInstallation['lifecycle_state'],
  nextState: PluginInstallation['lifecycle_state']
): void => {
  if (previousState === nextState) {
    return;
  }

  const allowed: Record<PluginInstallation['lifecycle_state'], PluginInstallation['lifecycle_state'][]> = {
    discovered: ['pending_confirmation', 'archived'],
    pending_confirmation: ['confirmed_disabled', 'archived', 'error'],
    confirmed_disabled: ['enabled', 'disabled', 'upgrade_pending_confirmation', 'archived', 'error'],
    enabled: ['disabled', 'upgrade_pending_confirmation', 'archived', 'error'],
    disabled: ['enabled', 'upgrade_pending_confirmation', 'archived', 'error'],
    upgrade_pending_confirmation: ['confirmed_disabled', 'archived', 'error'],
    error: ['disabled', 'confirmed_disabled', 'archived'],
    archived: []
  };

// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
  if (!allowed[previousState].includes(nextState)) {
    throw new ApiError(409, 'PLUGIN_LIFECYCLE_TRANSITION_INVALID', 'Plugin lifecycle transition is not allowed', {
      previous_state: previousState,
      next_state: nextState
    });
  }
};

const ensureInstallationExists = async (store: PluginStore, installationId: string): Promise<PluginInstallation> => {
  const installation = await store.getInstallationById(installationId);
  if (!installation) {
    throw new ApiError(404, 'PLUGIN_INSTALLATION_NOT_FOUND', 'Plugin installation not found', {
      installation_id: installationId
    });
  }

  return installation;
};

const normalizeGrantedCapabilities = (requested: string[], granted?: string[]): string[] => {
  if (!granted) {
    return requested;
  }

  const requestedSet = new Set(requested);
  return granted.filter(capability => requestedSet.has(capability));
};

export const createPluginManagerService = (store: PluginStore): PluginManagerService => {
  return {
    async registerArtifact(input) {
      return store.upsertArtifact(input);
    },

    async ensurePackLocalInstallation(input) {
      const scope_type: PluginInstallation['scope_type'] = 'pack_local';
      assertPackLocalScope(scope_type);

      const existing = await store.getInstallationByScope({
        plugin_id: input.artifact.plugin_id,
        scope_type,
        scope_ref: input.pack_id
      });

      const granted_capabilities = normalizeGrantedCapabilities(
        input.requested_capabilities,
        input.granted_capabilities
      );

      if (!existing) {
        const created = await store.upsertInstallation({
          installation_id: randomUUID(),
          plugin_id: input.artifact.plugin_id,
          artifact_id: input.artifact.artifact_id,
          version: input.artifact.version,
          scope_type,
          scope_ref: input.pack_id,
          lifecycle_state: 'pending_confirmation',
          requested_capabilities: input.requested_capabilities,
          granted_capabilities,
          trust_mode: input.trust_mode ?? TRUSTED_PLUGIN_TRUST_MODE
        });

        return {
          artifact: input.artifact,
          installation: created,
          status: 'created'
        };
      }

      const artifactChanged =
        existing.artifact_id !== input.artifact.artifact_id || existing.version !== input.artifact.version;
      const requestedChanged = JSON.stringify(existing.requested_capabilities) !== JSON.stringify(input.requested_capabilities);

      if (!artifactChanged && !requestedChanged) {
        return {
          artifact: input.artifact,
          installation: existing,
          status: 'unchanged'
        };
      }

      const nextState: PluginInstallation['lifecycle_state'] = artifactChanged
        ? 'upgrade_pending_confirmation'
        : existing.lifecycle_state;

      assertLifecycleTransition(existing.lifecycle_state, nextState);

      const updated = await store.upsertInstallation({
        installation_id: existing.installation_id,
        plugin_id: existing.plugin_id,
        artifact_id: input.artifact.artifact_id,
        version: input.artifact.version,
        scope_type: existing.scope_type,
        scope_ref: existing.scope_ref,
        lifecycle_state: nextState,
        requested_capabilities: input.requested_capabilities,
        granted_capabilities: artifactChanged ? [] : granted_capabilities,
        trust_mode: existing.trust_mode,
        confirmed_at: artifactChanged ? undefined : existing.confirmed_at,
        enabled_at: artifactChanged ? undefined : existing.enabled_at,
        disabled_at: artifactChanged ? existing.disabled_at : existing.disabled_at,
        last_error: undefined
      });

      return {
        artifact: input.artifact,
        installation: updated,
        status: artifactChanged ? 'upgrade_pending_confirmation' : 'updated'
      };
    },

    async confirmInstallation(input) {
      const existing = await ensureInstallationExists(store, input.installation_id);
      assertLifecycleTransition(existing.lifecycle_state, 'confirmed_disabled');

      const granted_capabilities = normalizeGrantedCapabilities(
        existing.requested_capabilities,
        input.granted_capabilities ?? existing.requested_capabilities
      );

      return store.upsertInstallation({
        installation_id: existing.installation_id,
        plugin_id: existing.plugin_id,
        artifact_id: existing.artifact_id,
        version: existing.version,
        scope_type: existing.scope_type,
        scope_ref: existing.scope_ref,
        lifecycle_state: 'confirmed_disabled',
        requested_capabilities: existing.requested_capabilities,
        granted_capabilities,
        trust_mode: existing.trust_mode,
        confirmed_at: input.confirmed_at,
        enabled_at: undefined,
        disabled_at: existing.disabled_at,
        last_error: undefined
      });
    },

    async enableInstallation(input) {
      const existing = await ensureInstallationExists(store, input.installation_id);
      assertLifecycleTransition(existing.lifecycle_state, 'enabled');

      const granted_capabilities = normalizeGrantedCapabilities(
        existing.requested_capabilities,
        input.granted_capabilities ?? existing.granted_capabilities
      );

      return store.upsertInstallation({
        installation_id: existing.installation_id,
        plugin_id: existing.plugin_id,
        artifact_id: existing.artifact_id,
        version: existing.version,
        scope_type: existing.scope_type,
        scope_ref: existing.scope_ref,
        lifecycle_state: 'enabled',
        requested_capabilities: existing.requested_capabilities,
        granted_capabilities,
        trust_mode: existing.trust_mode,
        confirmed_at: existing.confirmed_at,
        enabled_at: input.enabled_at,
        disabled_at: undefined,
        last_error: undefined
      });
    },

    async disableInstallation(input) {
      const existing = await ensureInstallationExists(store, input.installation_id);
      assertLifecycleTransition(existing.lifecycle_state, 'disabled');

      return store.upsertInstallation({
        installation_id: existing.installation_id,
        plugin_id: existing.plugin_id,
        artifact_id: existing.artifact_id,
        version: existing.version,
        scope_type: existing.scope_type,
        scope_ref: existing.scope_ref,
        lifecycle_state: 'disabled',
        requested_capabilities: existing.requested_capabilities,
        granted_capabilities: existing.granted_capabilities,
        trust_mode: existing.trust_mode,
        confirmed_at: existing.confirmed_at,
        enabled_at: existing.enabled_at,
        disabled_at: input.disabled_at,
        last_error: undefined
      });
    },

    async markInstallationError(input) {
      const existing = await ensureInstallationExists(store, input.installation_id);
      assertLifecycleTransition(existing.lifecycle_state, 'error');

      return store.upsertInstallation({
        installation_id: existing.installation_id,
        plugin_id: existing.plugin_id,
        artifact_id: existing.artifact_id,
        version: existing.version,
        scope_type: existing.scope_type,
        scope_ref: existing.scope_ref,
        lifecycle_state: 'error',
        requested_capabilities: existing.requested_capabilities,
        granted_capabilities: existing.granted_capabilities,
        trust_mode: existing.trust_mode,
        confirmed_at: existing.confirmed_at,
        enabled_at: existing.enabled_at,
        disabled_at: existing.disabled_at,
        last_error: input.error_message
      });
    },

    async archiveInstallation(input) {
      const existing = await ensureInstallationExists(store, input.installation_id);
      assertLifecycleTransition(existing.lifecycle_state, 'archived');

      return store.upsertInstallation({
        installation_id: existing.installation_id,
        plugin_id: existing.plugin_id,
        artifact_id: existing.artifact_id,
        version: existing.version,
        scope_type: existing.scope_type,
        scope_ref: existing.scope_ref,
        lifecycle_state: 'archived',
        requested_capabilities: existing.requested_capabilities,
        granted_capabilities: existing.granted_capabilities,
        trust_mode: existing.trust_mode,
        confirmed_at: existing.confirmed_at,
        enabled_at: existing.enabled_at,
        disabled_at: existing.disabled_at,
        last_error: existing.last_error
      });
    },

    async createActivationSession(input) {
      return store.createActivationSession(input);
    },

    async completeActivationSession(input) {
      return store.updateActivationSession(input.activation_id, {
        result: input.result,
        finished_at: input.finished_at,
        loaded_server: input.loaded_server,
        loaded_web_manifest: input.loaded_web_manifest,
        error_message: input.error_message
      });
    },

    async recordEnableAcknowledgement(input: PluginEnableAcknowledgementCreateInput): Promise<PluginEnableAcknowledgement> {
      if (!input.acknowledged) {
        throw new ApiError(400, PLUGIN_ENABLE_ACK_REQUIRED_CODE, 'Plugin enable acknowledgement is required', {
          installation_id: input.installation_id,
          pack_id: input.pack_id
        });
      }

      return store.createEnableAcknowledgement(input);
    },

    getManifestFingerprint(manifest: PluginManifest): string {
      return createHash('sha256')
        .update(JSON.stringify(manifest))
        .digest('hex');
    }
  };
};

export const assertPluginEnableAllowed = (installation: PluginInstallation): PluginInstallation => {
  if (installation.lifecycle_state !== 'confirmed_disabled' && installation.lifecycle_state !== 'disabled') {
    throw new ApiError(409, 'PLUGIN_ENABLE_INVALID_STATE', 'Plugin installation is not in an enable-able state', {
      installation_id: installation.installation_id,
      lifecycle_state: installation.lifecycle_state
    });
  }

  return parsePluginInstallation(installation);
};

export const assertPluginActivationCompleted = (session: PluginActivationSession): PluginActivationSession => {
  if (!session.finished_at) {
    throw new ApiError(409, 'PLUGIN_ACTIVATION_INCOMPLETE', 'Plugin activation session has not finished yet', {
      activation_id: session.activation_id
    });
  }

  return parsePluginActivationSession(session);
};

export const assertPluginAcknowledged = (ack: PluginEnableAcknowledgement | null): PluginEnableAcknowledgement => {
  if (!ack || !ack.acknowledged) {
    throw new ApiError(400, PLUGIN_ENABLE_ACK_REQUIRED_CODE, 'Plugin enable acknowledgement is required');
  }

  return parsePluginEnableAcknowledgement(ack);
};
