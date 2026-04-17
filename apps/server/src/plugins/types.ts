import type {
  PluginActivationSession,
  PluginArtifact,
  PluginEnableAcknowledgement,
  PluginInstallation,
  PluginManifest
} from '@yidhras/contracts';

export type PluginScopeType = PluginInstallation['scope_type'];
export type PluginLifecycleState = PluginInstallation['lifecycle_state'];
export type PluginTrustMode = PluginInstallation['trust_mode'];
export type PluginActivationChannel = PluginActivationSession['channel'];
export type PluginAcknowledgementChannel = PluginEnableAcknowledgement['channel'];

export interface PluginInstallationUpsertInput {
  installation_id: string;
  plugin_id: string;
  artifact_id: string;
  version: string;
  scope_type: PluginScopeType;
  scope_ref?: string;
  lifecycle_state: PluginLifecycleState;
  requested_capabilities: string[];
  granted_capabilities: string[];
  trust_mode: PluginTrustMode;
  failure_policy?: 'fail_open' | 'block_pack_activation';
  confirmed_at?: string;
  enabled_at?: string;
  disabled_at?: string;
  last_error?: string;
}

export interface PluginActivationSessionCreateInput {
  activation_id: string;
  installation_id: string;
  pack_id: string;
  channel: PluginActivationChannel;
  result: PluginActivationSession['result'];
  started_at: string;
  finished_at?: string;
  loaded_server?: boolean;
  loaded_web_manifest?: boolean;
  error_message?: string;
}

export interface PluginEnableAcknowledgementCreateInput {
  acknowledgement_id: string;
  installation_id: string;
  pack_id: string;
  channel: PluginAcknowledgementChannel;
  reminder_text_hash: string;
  acknowledged: boolean;
  actor_id?: string;
  actor_label?: string;
  created_at: string;
}

export interface PluginStore {
  getArtifactById(artifactId: string): Promise<PluginArtifact | null>;
  getArtifactByChecksum(checksum: string): Promise<PluginArtifact | null>;
  upsertArtifact(input: PluginArtifact): Promise<PluginArtifact>;
  getInstallationById(installationId: string): Promise<PluginInstallation | null>;
  getInstallationByScope(input: { plugin_id: string; scope_type: PluginScopeType; scope_ref?: string }): Promise<PluginInstallation | null>;
  listInstallationsByScope(input: { scope_type: PluginScopeType; scope_ref?: string }): Promise<PluginInstallation[]>;
  upsertInstallation(input: PluginInstallationUpsertInput): Promise<PluginInstallation>;
  createActivationSession(input: PluginActivationSessionCreateInput): Promise<PluginActivationSession>;
  updateActivationSession(
    activationId: string,
    patch: Partial<Pick<PluginActivationSession, 'result' | 'finished_at' | 'loaded_server' | 'loaded_web_manifest' | 'error_message'>>
  ): Promise<PluginActivationSession>;
  createEnableAcknowledgement(input: PluginEnableAcknowledgementCreateInput): Promise<PluginEnableAcknowledgement>;
  getLatestEnableAcknowledgement(installationId: string): Promise<PluginEnableAcknowledgement | null>;
}

export interface PluginRegistrationResult {
  artifact: PluginArtifact;
  installation: PluginInstallation;
  status: 'created' | 'updated' | 'unchanged' | 'upgrade_pending_confirmation';
}

export interface PluginManagerService {
  registerArtifact(input: PluginArtifact): Promise<PluginArtifact>;
  ensurePackLocalInstallation(input: {
    artifact: PluginArtifact;
    pack_id: string;
    requested_capabilities: string[];
    granted_capabilities?: string[];
    trust_mode?: PluginTrustMode;
  }): Promise<PluginRegistrationResult>;
  confirmInstallation(input: {
    installation_id: string;
    granted_capabilities?: string[];
    confirmed_at: string;
  }): Promise<PluginInstallation>;
  enableInstallation(input: {
    installation_id: string;
    enabled_at: string;
    granted_capabilities?: string[];
  }): Promise<PluginInstallation>;
  disableInstallation(input: {
    installation_id: string;
    disabled_at: string;
  }): Promise<PluginInstallation>;
  markInstallationError(input: {
    installation_id: string;
    error_message: string;
  }): Promise<PluginInstallation>;
  archiveInstallation(input: {
    installation_id: string;
  }): Promise<PluginInstallation>;
  createActivationSession(input: PluginActivationSessionCreateInput): Promise<PluginActivationSession>;
  completeActivationSession(input: {
    activation_id: string;
    result: PluginActivationSession['result'];
    finished_at: string;
    loaded_server?: boolean;
    loaded_web_manifest?: boolean;
    error_message?: string;
  }): Promise<PluginActivationSession>;
  recordEnableAcknowledgement(input: PluginEnableAcknowledgementCreateInput): Promise<PluginEnableAcknowledgement>;
  getManifestFingerprint(manifest: PluginManifest): string;
}
