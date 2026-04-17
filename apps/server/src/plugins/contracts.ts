import {
  type PluginActivationSession,
  pluginActivationSessionSchema,
  type PluginArtifact,
  pluginArtifactSchema,
  type PluginAuditEventCode,
  pluginAuditEventCodeSchema,
  type PluginEnableAcknowledgement,
  pluginEnableAcknowledgementSchema,
  type PluginInstallation,
  pluginInstallationSchema,
  type PluginManifest,
  pluginManifestSchema,
  pluginRuntimeWarningConfigSchema} from '@yidhras/contracts';

export const TRUSTED_PLUGIN_TRUST_MODE = 'trusted' as const;

export const PLUGIN_ENABLE_WARNING_TEXT = `We trust you have received the usual lecture from the local System
Administrator. It usually boils down to these three things:

#1) Respect the privacy of others.
#2) Think before you type.
#3) With great power comes great responsibility.`;

export const PLUGIN_ENABLE_ACK_REQUIRED_CODE = 'PLUGIN_ENABLE_ACK_REQUIRED';
export const PLUGIN_MANIFEST_INVALID_CODE = 'PLUGIN_MANIFEST_INVALID';
export const PLUGIN_INSTALLATION_INVALID_CODE = 'PLUGIN_INSTALLATION_INVALID';

export const PLUGIN_AUDIT_EVENT_CODES = pluginAuditEventCodeSchema.options;

export type PluginRuntimeWarningConfig = ReturnType<typeof pluginRuntimeWarningConfigSchema.parse>;

export const parsePluginManifest = (input: unknown): PluginManifest => {
  return pluginManifestSchema.parse(input);
};

export const parsePluginArtifact = (input: unknown): PluginArtifact => {
  return pluginArtifactSchema.parse(input);
};

export const parsePluginInstallation = (input: unknown): PluginInstallation => {
  return pluginInstallationSchema.parse(input);
};

export const parsePluginActivationSession = (input: unknown): PluginActivationSession => {
  return pluginActivationSessionSchema.parse(input);
};

export const parsePluginEnableAcknowledgement = (input: unknown): PluginEnableAcknowledgement => {
  return pluginEnableAcknowledgementSchema.parse(input);
};

export const parsePluginAuditEventCode = (input: unknown): PluginAuditEventCode => {
  return pluginAuditEventCodeSchema.parse(input);
};
