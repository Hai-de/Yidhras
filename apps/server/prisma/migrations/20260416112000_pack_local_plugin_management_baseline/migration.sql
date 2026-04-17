-- CreateTable
CREATE TABLE "PluginArtifact" (
    "artifact_id" TEXT NOT NULL PRIMARY KEY,
    "plugin_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "manifest_version" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_pack_id" TEXT,
    "source_path" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "manifest_json" JSONB NOT NULL,
    "imported_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "PluginInstallation" (
    "installation_id" TEXT NOT NULL PRIMARY KEY,
    "plugin_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_ref" TEXT,
    "lifecycle_state" TEXT NOT NULL,
    "requested_capabilities" TEXT NOT NULL,
    "granted_capabilities" TEXT NOT NULL,
    "trust_mode" TEXT NOT NULL,
    "failure_policy" TEXT NOT NULL DEFAULT 'fail_open',
    "confirmed_at" BIGINT,
    "enabled_at" BIGINT,
    "disabled_at" BIGINT,
    "last_error" TEXT,
    CONSTRAINT "PluginInstallation_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "PluginArtifact" ("artifact_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PluginActivationSession" (
    "activation_id" TEXT NOT NULL PRIMARY KEY,
    "installation_id" TEXT NOT NULL,
    "pack_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "started_at" BIGINT NOT NULL,
    "finished_at" BIGINT,
    "loaded_server" BOOLEAN NOT NULL DEFAULT false,
    "loaded_web_manifest" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    CONSTRAINT "PluginActivationSession_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "PluginInstallation" ("installation_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PluginEnableAcknowledgement" (
    "acknowledgement_id" TEXT NOT NULL PRIMARY KEY,
    "installation_id" TEXT NOT NULL,
    "pack_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "reminder_text_hash" TEXT NOT NULL,
    "acknowledged" BOOLEAN NOT NULL,
    "actor_id" TEXT,
    "actor_label" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "PluginEnableAcknowledgement_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "PluginInstallation" ("installation_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PluginArtifact_plugin_id_version_idx" ON "PluginArtifact"("plugin_id", "version");

-- CreateIndex
CREATE INDEX "PluginArtifact_source_pack_id_plugin_id_idx" ON "PluginArtifact"("source_pack_id", "plugin_id");

-- CreateIndex
CREATE UNIQUE INDEX "PluginArtifact_checksum_key" ON "PluginArtifact"("checksum");

-- CreateIndex
CREATE INDEX "PluginInstallation_scope_type_scope_ref_lifecycle_state_idx" ON "PluginInstallation"("scope_type", "scope_ref", "lifecycle_state");

-- CreateIndex
CREATE UNIQUE INDEX "PluginInstallation_plugin_id_scope_type_scope_ref_key" ON "PluginInstallation"("plugin_id", "scope_type", "scope_ref");

-- CreateIndex
CREATE INDEX "PluginActivationSession_installation_id_started_at_idx" ON "PluginActivationSession"("installation_id", "started_at");

-- CreateIndex
CREATE INDEX "PluginActivationSession_pack_id_started_at_idx" ON "PluginActivationSession"("pack_id", "started_at");

-- CreateIndex
CREATE INDEX "PluginEnableAcknowledgement_installation_id_created_at_idx" ON "PluginEnableAcknowledgement"("installation_id", "created_at");

-- CreateIndex
CREATE INDEX "PluginEnableAcknowledgement_pack_id_created_at_idx" ON "PluginEnableAcknowledgement"("pack_id", "created_at");
