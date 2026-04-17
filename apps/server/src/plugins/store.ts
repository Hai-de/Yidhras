import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { getErrorMessage } from '../app/http/errors.js';
import {
  parsePluginActivationSession,
  parsePluginArtifact,
  parsePluginEnableAcknowledgement,
  parsePluginInstallation
} from './contracts.js';
import type {
  PluginActivationSessionCreateInput,
  PluginEnableAcknowledgementCreateInput,
  PluginInstallationUpsertInput,
  PluginStore
} from './types.js';

const parseStringArray = (value: string): string[] => {
  if (value.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  } catch {
    return [];
  }
};

const stringifyStringArray = (values: string[]): string => {
  return JSON.stringify(Array.from(new Set(values.filter(value => value.trim().length > 0))));
};

const toJsonValue = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
};

const isMissingPluginTablesError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2021';
  }

  const message = getErrorMessage(error);
  return (
    (message.includes('PluginArtifact')
      || message.includes('PluginInstallation')
      || message.includes('PluginActivationSession')
      || message.includes('PluginEnableAcknowledgement'))
    && message.includes('does not exist')
  );
};

const pluginTablesUnavailableError = (): Error => {
  return new Error('Plugin tables are not available yet. Run prisma migrate deploy before using pack-local plugins.');
};

export interface PluginStoreContext {
  prisma: PrismaClient;
}

export const createPluginStore = (context: PluginStoreContext): PluginStore => {
  return {
    async getArtifactById(artifactId) {
      try {
        const row = await context.prisma.pluginArtifact.findUnique({
          where: {
            artifact_id: artifactId
          }
        });

        if (!row) {
          return null;
        }

        return parsePluginArtifact({
          artifact_id: row.artifact_id,
          plugin_id: row.plugin_id,
          version: row.version,
          manifest_version: row.manifest_version,
          source_type: row.source_type,
          source_pack_id: row.source_pack_id ?? undefined,
          source_path: row.source_path,
          checksum: row.checksum,
          manifest_json: row.manifest_json,
          imported_at: row.imported_at.toString()
        });
      } catch (error) {
        if (isMissingPluginTablesError(error)) {
          return null;
        }

        throw error;
      }
    },

    async getArtifactByChecksum(checksum) {
      try {
        const row = await context.prisma.pluginArtifact.findUnique({
          where: {
            checksum
          }
        });

        if (!row) {
          return null;
        }

        return parsePluginArtifact({
          artifact_id: row.artifact_id,
          plugin_id: row.plugin_id,
          version: row.version,
          manifest_version: row.manifest_version,
          source_type: row.source_type,
          source_pack_id: row.source_pack_id ?? undefined,
          source_path: row.source_path,
          checksum: row.checksum,
          manifest_json: row.manifest_json,
          imported_at: row.imported_at.toString()
        });
      } catch (error) {
        if (isMissingPluginTablesError(error)) {
          return null;
        }

        throw error;
      }
    },

    async upsertArtifact(input) {
      try {
        const row = await context.prisma.pluginArtifact.upsert({
          where: {
            artifact_id: input.artifact_id
          },
          update: {
            plugin_id: input.plugin_id,
            version: input.version,
            manifest_version: input.manifest_version,
            source_type: input.source_type,
            source_pack_id: input.source_pack_id ?? null,
            source_path: input.source_path,
            checksum: input.checksum,
            manifest_json: toJsonValue(input.manifest_json),
            imported_at: BigInt(input.imported_at)
          },
          create: {
            artifact_id: input.artifact_id,
            plugin_id: input.plugin_id,
            version: input.version,
            manifest_version: input.manifest_version,
            source_type: input.source_type,
            source_pack_id: input.source_pack_id ?? null,
            source_path: input.source_path,
            checksum: input.checksum,
            manifest_json: toJsonValue(input.manifest_json),
            imported_at: BigInt(input.imported_at)
          }
        });

        return parsePluginArtifact({
          artifact_id: row.artifact_id,
          plugin_id: row.plugin_id,
          version: row.version,
          manifest_version: row.manifest_version,
          source_type: row.source_type,
          source_pack_id: row.source_pack_id ?? undefined,
          source_path: row.source_path,
          checksum: row.checksum,
          manifest_json: row.manifest_json,
          imported_at: row.imported_at.toString()
        });
      } catch (error) {
        if (isMissingPluginTablesError(error)) {
          throw pluginTablesUnavailableError();
        }

        throw error;
      }
    },

    async getInstallationById(installationId) {
      try {
        const row = await context.prisma.pluginInstallation.findUnique({
          where: {
            installation_id: installationId
          }
        });

        if (!row) {
          return null;
        }

        return parsePluginInstallation({
          installation_id: row.installation_id,
          plugin_id: row.plugin_id,
          artifact_id: row.artifact_id,
          version: row.version,
          scope_type: row.scope_type,
          scope_ref: row.scope_ref ?? undefined,
          lifecycle_state: row.lifecycle_state,
          requested_capabilities: parseStringArray(row.requested_capabilities),
          granted_capabilities: parseStringArray(row.granted_capabilities),
          trust_mode: row.trust_mode,
          confirmed_at: row.confirmed_at?.toString(),
          enabled_at: row.enabled_at?.toString(),
          disabled_at: row.disabled_at?.toString(),
          last_error: row.last_error ?? undefined
        });
      } catch (error) {
        if (isMissingPluginTablesError(error)) {
          return null;
        }

        throw error;
      }
    },

    async getInstallationByScope(input) {
      try {
        const row = await context.prisma.pluginInstallation.findFirst({
          where: {
            plugin_id: input.plugin_id,
            scope_type: input.scope_type,
            scope_ref: input.scope_ref ?? null
          }
        });

        if (!row) {
          return null;
        }

        return parsePluginInstallation({
          installation_id: row.installation_id,
          plugin_id: row.plugin_id,
          artifact_id: row.artifact_id,
          version: row.version,
          scope_type: row.scope_type,
          scope_ref: row.scope_ref ?? undefined,
          lifecycle_state: row.lifecycle_state,
          requested_capabilities: parseStringArray(row.requested_capabilities),
          granted_capabilities: parseStringArray(row.granted_capabilities),
          trust_mode: row.trust_mode,
          confirmed_at: row.confirmed_at?.toString(),
          enabled_at: row.enabled_at?.toString(),
          disabled_at: row.disabled_at?.toString(),
          last_error: row.last_error ?? undefined
        });
      } catch (error) {
        if (isMissingPluginTablesError(error)) {
          return null;
        }

        throw error;
      }
    },

    async listInstallationsByScope(input) {
      try {
        const rows = await context.prisma.pluginInstallation.findMany({
          where: {
            scope_type: input.scope_type,
            scope_ref: input.scope_ref ?? null
          },
          orderBy: [{ plugin_id: 'asc' }, { installation_id: 'asc' }]
        });

        return rows.map(row => parsePluginInstallation({
          installation_id: row.installation_id,
          plugin_id: row.plugin_id,
          artifact_id: row.artifact_id,
          version: row.version,
          scope_type: row.scope_type,
          scope_ref: row.scope_ref ?? undefined,
          lifecycle_state: row.lifecycle_state,
          requested_capabilities: parseStringArray(row.requested_capabilities),
          granted_capabilities: parseStringArray(row.granted_capabilities),
          trust_mode: row.trust_mode,
          confirmed_at: row.confirmed_at?.toString(),
          enabled_at: row.enabled_at?.toString(),
          disabled_at: row.disabled_at?.toString(),
          last_error: row.last_error ?? undefined
        }));
      } catch (error) {
        if (isMissingPluginTablesError(error)) {
          return [];
        }

        throw error;
      }
    },

    async upsertInstallation(input: PluginInstallationUpsertInput) {
      try {
        const row = await context.prisma.pluginInstallation.upsert({
          where: {
            installation_id: input.installation_id
          },
          update: {
            plugin_id: input.plugin_id,
            artifact_id: input.artifact_id,
            version: input.version,
            scope_type: input.scope_type,
            scope_ref: input.scope_ref ?? null,
            lifecycle_state: input.lifecycle_state,
            requested_capabilities: stringifyStringArray(input.requested_capabilities),
            granted_capabilities: stringifyStringArray(input.granted_capabilities),
            trust_mode: input.trust_mode,
            failure_policy: input.failure_policy ?? 'fail_open',
            confirmed_at: input.confirmed_at ? BigInt(input.confirmed_at) : null,
            enabled_at: input.enabled_at ? BigInt(input.enabled_at) : null,
            disabled_at: input.disabled_at ? BigInt(input.disabled_at) : null,
            last_error: input.last_error ?? null
          },
          create: {
            installation_id: input.installation_id,
            plugin_id: input.plugin_id,
            artifact_id: input.artifact_id,
            version: input.version,
            scope_type: input.scope_type,
            scope_ref: input.scope_ref ?? null,
            lifecycle_state: input.lifecycle_state,
            requested_capabilities: stringifyStringArray(input.requested_capabilities),
            granted_capabilities: stringifyStringArray(input.granted_capabilities),
            trust_mode: input.trust_mode,
            failure_policy: input.failure_policy ?? 'fail_open',
            confirmed_at: input.confirmed_at ? BigInt(input.confirmed_at) : null,
            enabled_at: input.enabled_at ? BigInt(input.enabled_at) : null,
            disabled_at: input.disabled_at ? BigInt(input.disabled_at) : null,
            last_error: input.last_error ?? null
          }
        });

        return parsePluginInstallation({
          installation_id: row.installation_id,
          plugin_id: row.plugin_id,
          artifact_id: row.artifact_id,
          version: row.version,
          scope_type: row.scope_type,
          scope_ref: row.scope_ref ?? undefined,
          lifecycle_state: row.lifecycle_state,
          requested_capabilities: parseStringArray(row.requested_capabilities),
          granted_capabilities: parseStringArray(row.granted_capabilities),
          trust_mode: row.trust_mode,
          confirmed_at: row.confirmed_at?.toString(),
          enabled_at: row.enabled_at?.toString(),
          disabled_at: row.disabled_at?.toString(),
          last_error: row.last_error ?? undefined
        });
      } catch (error) {
        if (isMissingPluginTablesError(error)) {
          throw pluginTablesUnavailableError();
        }

        throw error;
      }
    },

    async createActivationSession(input: PluginActivationSessionCreateInput) {
      try {
        const row = await context.prisma.pluginActivationSession.create({
          data: {
            activation_id: input.activation_id,
            installation_id: input.installation_id,
            pack_id: input.pack_id,
            channel: input.channel,
            result: input.result,
            started_at: BigInt(input.started_at),
            finished_at: input.finished_at ? BigInt(input.finished_at) : null,
            loaded_server: input.loaded_server ?? false,
            loaded_web_manifest: input.loaded_web_manifest ?? false,
            error_message: input.error_message ?? null
          }
        });

        return parsePluginActivationSession({
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
      } catch (error) {
        if (isMissingPluginTablesError(error)) {
          throw pluginTablesUnavailableError();
        }

        throw error;
      }
    },

    async updateActivationSession(activationId, patch) {
      try {
        const row = await context.prisma.pluginActivationSession.update({
          where: {
            activation_id: activationId
          },
          data: {
            ...(patch.result !== undefined ? { result: patch.result } : {}),
            ...(patch.finished_at !== undefined ? { finished_at: patch.finished_at ? BigInt(patch.finished_at) : null } : {}),
            ...(patch.loaded_server !== undefined ? { loaded_server: patch.loaded_server } : {}),
            ...(patch.loaded_web_manifest !== undefined ? { loaded_web_manifest: patch.loaded_web_manifest } : {}),
            ...(patch.error_message !== undefined ? { error_message: patch.error_message ?? null } : {})
          }
        });

        return parsePluginActivationSession({
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
      } catch (error) {
        if (isMissingPluginTablesError(error)) {
          throw pluginTablesUnavailableError();
        }

        throw error;
      }
    },

    async createEnableAcknowledgement(input: PluginEnableAcknowledgementCreateInput) {
      try {
        const row = await context.prisma.pluginEnableAcknowledgement.create({
          data: {
            acknowledgement_id: input.acknowledgement_id,
            installation_id: input.installation_id,
            pack_id: input.pack_id,
            channel: input.channel,
            reminder_text_hash: input.reminder_text_hash,
            acknowledged: input.acknowledged,
            actor_id: input.actor_id ?? null,
            actor_label: input.actor_label ?? null,
            created_at: BigInt(input.created_at)
          }
        });

        return parsePluginEnableAcknowledgement({
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
      } catch (error) {
        if (isMissingPluginTablesError(error)) {
          throw pluginTablesUnavailableError();
        }

        throw error;
      }
    },

    async getLatestEnableAcknowledgement(installationId) {
      try {
        const row = await context.prisma.pluginEnableAcknowledgement.findFirst({
          where: {
            installation_id: installationId
          },
          orderBy: [{ created_at: 'desc' }, { acknowledgement_id: 'desc' }]
        });

        if (!row) {
          return null;
        }

        return parsePluginEnableAcknowledgement({
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
      } catch (error) {
        if (isMissingPluginTablesError(error)) {
          return null;
        }

        throw error;
      }
    }
  };
};
