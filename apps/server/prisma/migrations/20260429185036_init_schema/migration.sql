-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "snr" REAL NOT NULL DEFAULT 0.5,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "AtmosphereNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "expires_at" BIGINT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "AtmosphereNode_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Circle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "CircleMember" (
    "agent_id" TEXT NOT NULL,
    "circle_id" TEXT NOT NULL,

    PRIMARY KEY ("agent_id", "circle_id"),
    CONSTRAINT "CircleMember_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CircleMember_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "Circle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "from_id" TEXT NOT NULL,
    "to_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1.0,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "Relationship_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Relationship_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RelationshipAdjustmentLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action_intent_id" TEXT NOT NULL,
    "relationship_id" TEXT NOT NULL,
    "from_id" TEXT NOT NULL,
    "to_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "old_weight" REAL,
    "new_weight" REAL NOT NULL,
    "reason" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "RelationshipAdjustmentLog_action_intent_id_fkey" FOREIGN KEY ("action_intent_id") REFERENCES "ActionIntent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RelationshipAdjustmentLog_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "Relationship" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SNRAdjustmentLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action_intent_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requested_value" REAL NOT NULL,
    "baseline_value" REAL NOT NULL,
    "resolved_value" REAL NOT NULL,
    "reason" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "SNRAdjustmentLog_action_intent_id_fkey" FOREIGN KEY ("action_intent_id") REFERENCES "ActionIntent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SNRAdjustmentLog_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "author_id" TEXT NOT NULL,
    "source_action_intent_id" TEXT,
    "content" TEXT NOT NULL,
    "noise_level" REAL NOT NULL DEFAULT 0.0,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "Post_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Post_source_action_intent_id_fkey" FOREIGN KEY ("source_action_intent_id") REFERENCES "ActionIntent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tick" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "impact_data" TEXT,
    "source_action_intent_id" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "Event_source_action_intent_id_fkey" FOREIGN KEY ("source_action_intent_id") REFERENCES "ActionIntent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorldVariable" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "Identity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'm2',
    "status" TEXT NOT NULL DEFAULT 'active',
    "claims" JSONB,
    "metadata" JSONB,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "IdentityNodeBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identity_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "atmosphere_node_id" TEXT,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "pack_id" TEXT,
    "expires_at" BIGINT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "IdentityNodeBinding_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "Identity" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IdentityNodeBinding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "IdentityNodeBinding_atmosphere_node_id_fkey" FOREIGN KEY ("atmosphere_node_id") REFERENCES "AtmosphereNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "effect" TEXT NOT NULL,
    "subject_id" TEXT,
    "subject_type" TEXT,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "conditions" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "Policy_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "Identity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InferenceTrace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "actor_ref" JSONB NOT NULL,
    "input" JSONB NOT NULL,
    "context_snapshot" JSONB NOT NULL,
    "prompt_bundle" JSONB NOT NULL,
    "trace_metadata" JSONB NOT NULL,
    "decision" JSONB,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "ActionIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_inference_id" TEXT NOT NULL,
    "intent_type" TEXT NOT NULL,
    "actor_ref" JSONB NOT NULL,
    "target_ref" JSONB,
    "payload" JSONB NOT NULL,
    "scheduled_after_ticks" BIGINT,
    "scheduled_for_tick" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "locked_by" TEXT,
    "locked_at" BIGINT,
    "lock_expires_at" BIGINT,
    "dispatch_started_at" BIGINT,
    "dispatched_at" BIGINT,
    "transmission_delay_ticks" BIGINT,
    "transmission_policy" TEXT NOT NULL DEFAULT 'reliable',
    "transmission_drop_chance" REAL NOT NULL DEFAULT 0,
    "drop_reason" TEXT,
    "dispatch_error_code" TEXT,
    "dispatch_error_message" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "ActionIntent_source_inference_id_fkey" FOREIGN KEY ("source_inference_id") REFERENCES "InferenceTrace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DecisionJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_inference_id" TEXT,
    "replay_of_job_id" TEXT,
    "replay_source_trace_id" TEXT,
    "replay_reason" TEXT,
    "action_intent_id" TEXT,
    "job_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "pending_source_key" TEXT,
    "request_input" JSONB,
    "replay_override_snapshot" JSONB,
    "last_error" TEXT,
    "last_error_code" TEXT,
    "last_error_stage" TEXT,
    "started_at" BIGINT,
    "next_retry_at" BIGINT,
    "locked_by" TEXT,
    "locked_at" BIGINT,
    "lock_expires_at" BIGINT,
    "scheduled_for_tick" BIGINT,
    "intent_class" TEXT NOT NULL DEFAULT 'direct_inference',
    "pack_id" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "completed_at" BIGINT,
    CONSTRAINT "DecisionJob_source_inference_id_fkey" FOREIGN KEY ("source_inference_id") REFERENCES "InferenceTrace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DecisionJob_replay_source_trace_id_fkey" FOREIGN KEY ("replay_source_trace_id") REFERENCES "InferenceTrace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DecisionJob_replay_of_job_id_fkey" FOREIGN KEY ("replay_of_job_id") REFERENCES "DecisionJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DecisionJob_action_intent_id_fkey" FOREIGN KEY ("action_intent_id") REFERENCES "ActionIntent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiInvocationRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "source_inference_id" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "route_id" TEXT,
    "status" TEXT NOT NULL,
    "finish_reason" TEXT NOT NULL,
    "attempted_models_json" JSONB NOT NULL,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "latency_ms" INTEGER,
    "usage_json" JSONB,
    "safety_json" JSONB,
    "request_json" JSONB,
    "response_json" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "error_stage" TEXT,
    "audit_level" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "completed_at" BIGINT,
    CONSTRAINT "AiInvocationRecord_source_inference_id_fkey" FOREIGN KEY ("source_inference_id") REFERENCES "InferenceTrace" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContextOverlayEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_id" TEXT NOT NULL,
    "pack_id" TEXT,
    "overlay_type" TEXT NOT NULL,
    "title" TEXT,
    "content_text" TEXT NOT NULL,
    "content_structured" JSONB,
    "tags" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "persistence_mode" TEXT NOT NULL,
    "source_node_ids" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at_tick" BIGINT NOT NULL,
    "updated_at_tick" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "MemoryBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_agent_id" TEXT NOT NULL,
    "pack_id" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT,
    "content_text" TEXT NOT NULL,
    "content_structured" JSONB,
    "tags" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "source_ref" JSONB,
    "importance" REAL NOT NULL,
    "salience" REAL NOT NULL,
    "confidence" REAL,
    "created_at_tick" BIGINT NOT NULL,
    "updated_at_tick" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "MemoryBlockBehavior" (
    "memory_block_id" TEXT NOT NULL PRIMARY KEY,
    "behavior_json" JSONB NOT NULL,
    "created_at_tick" BIGINT NOT NULL,
    "updated_at_tick" BIGINT NOT NULL,
    CONSTRAINT "MemoryBlockBehavior_memory_block_id_fkey" FOREIGN KEY ("memory_block_id") REFERENCES "MemoryBlock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryBlockRuntimeState" (
    "memory_block_id" TEXT NOT NULL PRIMARY KEY,
    "trigger_count" INTEGER NOT NULL DEFAULT 0,
    "last_triggered_tick" BIGINT,
    "last_inserted_tick" BIGINT,
    "cooldown_until_tick" BIGINT,
    "delayed_until_tick" BIGINT,
    "retain_until_tick" BIGINT,
    "currently_active" BOOLEAN NOT NULL DEFAULT false,
    "last_activation_score" REAL,
    "recent_distance_from_latest_message" INTEGER,
    CONSTRAINT "MemoryBlockRuntimeState_memory_block_id_fkey" FOREIGN KEY ("memory_block_id") REFERENCES "MemoryBlock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryBlockDeletionAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memory_block_id" TEXT NOT NULL,
    "deleted_by" TEXT NOT NULL,
    "actor_id" TEXT,
    "reason" TEXT,
    "deleted_at_tick" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "MemoryCompactionState" (
    "agent_id" TEXT NOT NULL PRIMARY KEY,
    "pack_id" TEXT,
    "inference_count_since_summary" INTEGER NOT NULL DEFAULT 0,
    "inference_count_since_compaction" INTEGER NOT NULL DEFAULT 0,
    "last_summary_tick" BIGINT,
    "last_compaction_tick" BIGINT,
    "updated_at_tick" BIGINT NOT NULL
);

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

-- CreateTable
CREATE TABLE "ScenarioEntityState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pack_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "state_json" JSONB NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "SchedulerRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "worker_id" TEXT NOT NULL,
    "partition_id" TEXT NOT NULL DEFAULT 'p0',
    "lease_holder" TEXT,
    "lease_expires_at_snapshot" BIGINT,
    "tick" BIGINT NOT NULL,
    "summary" JSONB NOT NULL,
    "started_at" BIGINT NOT NULL,
    "finished_at" BIGINT NOT NULL,
    "created_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "SchedulerCandidateDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduler_run_id" TEXT NOT NULL,
    "partition_id" TEXT NOT NULL DEFAULT 'p0',
    "actor_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "candidate_reasons" JSONB NOT NULL,
    "chosen_reason" TEXT NOT NULL,
    "scheduled_for_tick" BIGINT NOT NULL,
    "priority_score" INTEGER NOT NULL,
    "skipped_reason" TEXT,
    "created_job_id" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "SchedulerCandidateDecision_scheduler_run_id_fkey" FOREIGN KEY ("scheduler_run_id") REFERENCES "SchedulerRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SchedulerLease" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "partition_id" TEXT NOT NULL DEFAULT 'p0',
    "holder" TEXT NOT NULL,
    "acquired_at" BIGINT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "SchedulerCursor" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "partition_id" TEXT NOT NULL DEFAULT 'p0',
    "last_scanned_tick" BIGINT NOT NULL,
    "last_signal_tick" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "SchedulerPartitionAssignment" (
    "partition_id" TEXT NOT NULL PRIMARY KEY,
    "worker_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'released',
    "version" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'bootstrap',
    "updated_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "SchedulerOwnershipMigrationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partition_id" TEXT NOT NULL,
    "from_worker_id" TEXT,
    "to_worker_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "details" JSONB,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "completed_at" BIGINT
);

-- CreateTable
CREATE TABLE "SchedulerWorkerRuntimeState" (
    "worker_id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_heartbeat_at" BIGINT NOT NULL,
    "owned_partition_count" INTEGER NOT NULL DEFAULT 0,
    "active_migration_count" INTEGER NOT NULL DEFAULT 0,
    "capacity_hint" INTEGER,
    "updated_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "SchedulerRebalanceRecommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partition_id" TEXT NOT NULL,
    "from_worker_id" TEXT,
    "to_worker_id" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "score" REAL,
    "suppress_reason" TEXT,
    "details" JSONB,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "applied_migration_id" TEXT
);

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identity_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_root" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "display_name" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "Operator_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "Identity" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OperatorSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operator_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "pack_id" TEXT,
    "expires_at" BIGINT NOT NULL,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "OperatorSession_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "Operator" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OperatorPackBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operator_id" TEXT NOT NULL,
    "pack_id" TEXT NOT NULL,
    "binding_type" TEXT NOT NULL DEFAULT 'member',
    "bound_at" BIGINT NOT NULL,
    "bound_by" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "OperatorPackBinding_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "Operator" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OperatorGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "giver_operator_id" TEXT NOT NULL,
    "receiver_identity_id" TEXT NOT NULL,
    "pack_id" TEXT NOT NULL,
    "capability_key" TEXT NOT NULL,
    "scope_json" JSONB,
    "revocable" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" BIGINT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "OperatorGrant_giver_operator_id_fkey" FOREIGN KEY ("giver_operator_id") REFERENCES "Operator" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OperatorAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operator_id" TEXT,
    "pack_id" TEXT,
    "action" TEXT NOT NULL,
    "target_id" TEXT,
    "detail_json" JSONB,
    "client_ip" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "OperatorAuditLog_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "Operator" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Relationship_from_id_to_id_type_key" ON "Relationship"("from_id", "to_id", "type");

-- CreateIndex
CREATE INDEX "RelationshipAdjustmentLog_action_intent_id_created_at_idx" ON "RelationshipAdjustmentLog"("action_intent_id", "created_at");

-- CreateIndex
CREATE INDEX "RelationshipAdjustmentLog_relationship_id_created_at_idx" ON "RelationshipAdjustmentLog"("relationship_id", "created_at");

-- CreateIndex
CREATE INDEX "RelationshipAdjustmentLog_from_id_to_id_type_created_at_idx" ON "RelationshipAdjustmentLog"("from_id", "to_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "SNRAdjustmentLog_action_intent_id_created_at_idx" ON "SNRAdjustmentLog"("action_intent_id", "created_at");

-- CreateIndex
CREATE INDEX "SNRAdjustmentLog_agent_id_created_at_idx" ON "SNRAdjustmentLog"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "Post_source_action_intent_id_created_at_idx" ON "Post"("source_action_intent_id", "created_at");

-- CreateIndex
CREATE INDEX "Event_tick_idx" ON "Event"("tick");

-- CreateIndex
CREATE INDEX "Event_type_tick_idx" ON "Event"("type", "tick");

-- CreateIndex
CREATE INDEX "Event_source_action_intent_id_tick_idx" ON "Event"("source_action_intent_id", "tick");

-- CreateIndex
CREATE INDEX "IdentityNodeBinding_identity_id_idx" ON "IdentityNodeBinding"("identity_id");

-- CreateIndex
CREATE INDEX "IdentityNodeBinding_agent_id_idx" ON "IdentityNodeBinding"("agent_id");

-- CreateIndex
CREATE INDEX "IdentityNodeBinding_atmosphere_node_id_idx" ON "IdentityNodeBinding"("atmosphere_node_id");

-- CreateIndex
CREATE INDEX "IdentityNodeBinding_role_status_idx" ON "IdentityNodeBinding"("role", "status");

-- CreateIndex
CREATE INDEX "Policy_resource_action_idx" ON "Policy"("resource", "action");

-- CreateIndex
CREATE INDEX "Policy_subject_id_idx" ON "Policy"("subject_id");

-- CreateIndex
CREATE INDEX "Policy_subject_type_idx" ON "Policy"("subject_type");

-- CreateIndex
CREATE INDEX "InferenceTrace_kind_created_at_idx" ON "InferenceTrace"("kind", "created_at");

-- CreateIndex
CREATE INDEX "InferenceTrace_strategy_provider_idx" ON "InferenceTrace"("strategy", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ActionIntent_source_inference_id_key" ON "ActionIntent"("source_inference_id");

-- CreateIndex
CREATE INDEX "ActionIntent_status_created_at_idx" ON "ActionIntent"("status", "created_at");

-- CreateIndex
CREATE INDEX "ActionIntent_status_lock_expires_at_idx" ON "ActionIntent"("status", "lock_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionJob_source_inference_id_key" ON "DecisionJob"("source_inference_id");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionJob_action_intent_id_key" ON "DecisionJob"("action_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionJob_idempotency_key_key" ON "DecisionJob"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionJob_pending_source_key_key" ON "DecisionJob"("pending_source_key");

-- CreateIndex
CREATE INDEX "DecisionJob_status_created_at_idx" ON "DecisionJob"("status", "created_at");

-- CreateIndex
CREATE INDEX "DecisionJob_status_lock_expires_at_idx" ON "DecisionJob"("status", "lock_expires_at");

-- CreateIndex
CREATE INDEX "DecisionJob_status_scheduled_for_tick_idx" ON "DecisionJob"("status", "scheduled_for_tick");

-- CreateIndex
CREATE INDEX "DecisionJob_intent_class_created_at_idx" ON "DecisionJob"("intent_class", "created_at");

-- CreateIndex
CREATE INDEX "DecisionJob_replay_of_job_id_created_at_idx" ON "DecisionJob"("replay_of_job_id", "created_at");

-- CreateIndex
CREATE INDEX "AiInvocationRecord_source_inference_id_created_at_idx" ON "AiInvocationRecord"("source_inference_id", "created_at");

-- CreateIndex
CREATE INDEX "AiInvocationRecord_task_type_created_at_idx" ON "AiInvocationRecord"("task_type", "created_at");

-- CreateIndex
CREATE INDEX "AiInvocationRecord_provider_model_created_at_idx" ON "AiInvocationRecord"("provider", "model", "created_at");

-- CreateIndex
CREATE INDEX "AiInvocationRecord_status_created_at_idx" ON "AiInvocationRecord"("status", "created_at");

-- CreateIndex
CREATE INDEX "ContextOverlayEntry_actor_id_updated_at_tick_idx" ON "ContextOverlayEntry"("actor_id", "updated_at_tick");

-- CreateIndex
CREATE INDEX "ContextOverlayEntry_actor_id_pack_id_status_idx" ON "ContextOverlayEntry"("actor_id", "pack_id", "status");

-- CreateIndex
CREATE INDEX "ContextOverlayEntry_overlay_type_status_idx" ON "ContextOverlayEntry"("overlay_type", "status");

-- CreateIndex
CREATE INDEX "MemoryBlock_owner_agent_id_updated_at_tick_idx" ON "MemoryBlock"("owner_agent_id", "updated_at_tick");

-- CreateIndex
CREATE INDEX "MemoryBlock_owner_agent_id_pack_id_status_idx" ON "MemoryBlock"("owner_agent_id", "pack_id", "status");

-- CreateIndex
CREATE INDEX "MemoryBlock_kind_status_idx" ON "MemoryBlock"("kind", "status");

-- CreateIndex
CREATE INDEX "MemoryBlockRuntimeState_currently_active_last_triggered_tick_idx" ON "MemoryBlockRuntimeState"("currently_active", "last_triggered_tick");

-- CreateIndex
CREATE INDEX "MemoryBlockDeletionAudit_memory_block_id_deleted_at_tick_idx" ON "MemoryBlockDeletionAudit"("memory_block_id", "deleted_at_tick");

-- CreateIndex
CREATE INDEX "MemoryCompactionState_pack_id_updated_at_tick_idx" ON "MemoryCompactionState"("pack_id", "updated_at_tick");

-- CreateIndex
CREATE UNIQUE INDEX "PluginArtifact_checksum_key" ON "PluginArtifact"("checksum");

-- CreateIndex
CREATE INDEX "PluginArtifact_plugin_id_version_idx" ON "PluginArtifact"("plugin_id", "version");

-- CreateIndex
CREATE INDEX "PluginArtifact_source_pack_id_plugin_id_idx" ON "PluginArtifact"("source_pack_id", "plugin_id");

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

-- CreateIndex
CREATE INDEX "ScenarioEntityState_pack_id_entity_type_idx" ON "ScenarioEntityState"("pack_id", "entity_type");

-- CreateIndex
CREATE INDEX "ScenarioEntityState_entity_type_entity_id_idx" ON "ScenarioEntityState"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioEntityState_pack_id_entity_type_entity_id_key" ON "ScenarioEntityState"("pack_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "SchedulerRun_tick_created_at_idx" ON "SchedulerRun"("tick", "created_at");

-- CreateIndex
CREATE INDEX "SchedulerRun_partition_id_created_at_idx" ON "SchedulerRun"("partition_id", "created_at");

-- CreateIndex
CREATE INDEX "SchedulerCandidateDecision_scheduler_run_id_created_at_idx" ON "SchedulerCandidateDecision"("scheduler_run_id", "created_at");

-- CreateIndex
CREATE INDEX "SchedulerCandidateDecision_actor_id_created_at_idx" ON "SchedulerCandidateDecision"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "SchedulerCandidateDecision_partition_id_created_at_idx" ON "SchedulerCandidateDecision"("partition_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulerLease_partition_id_key" ON "SchedulerLease"("partition_id");

-- CreateIndex
CREATE INDEX "SchedulerLease_partition_id_expires_at_idx" ON "SchedulerLease"("partition_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulerCursor_partition_id_key" ON "SchedulerCursor"("partition_id");

-- CreateIndex
CREATE INDEX "SchedulerPartitionAssignment_worker_id_updated_at_idx" ON "SchedulerPartitionAssignment"("worker_id", "updated_at");

-- CreateIndex
CREATE INDEX "SchedulerPartitionAssignment_status_updated_at_idx" ON "SchedulerPartitionAssignment"("status", "updated_at");

-- CreateIndex
CREATE INDEX "SchedulerOwnershipMigrationLog_partition_id_created_at_idx" ON "SchedulerOwnershipMigrationLog"("partition_id", "created_at");

-- CreateIndex
CREATE INDEX "SchedulerOwnershipMigrationLog_to_worker_id_created_at_idx" ON "SchedulerOwnershipMigrationLog"("to_worker_id", "created_at");

-- CreateIndex
CREATE INDEX "SchedulerOwnershipMigrationLog_status_created_at_idx" ON "SchedulerOwnershipMigrationLog"("status", "created_at");

-- CreateIndex
CREATE INDEX "SchedulerWorkerRuntimeState_status_updated_at_idx" ON "SchedulerWorkerRuntimeState"("status", "updated_at");

-- CreateIndex
CREATE INDEX "SchedulerWorkerRuntimeState_last_heartbeat_at_idx" ON "SchedulerWorkerRuntimeState"("last_heartbeat_at");

-- CreateIndex
CREATE INDEX "SchedulerRebalanceRecommendation_status_created_at_idx" ON "SchedulerRebalanceRecommendation"("status", "created_at");

-- CreateIndex
CREATE INDEX "SchedulerRebalanceRecommendation_partition_id_created_at_idx" ON "SchedulerRebalanceRecommendation"("partition_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "Operator_identity_id_key" ON "Operator"("identity_id");

-- CreateIndex
CREATE UNIQUE INDEX "Operator_username_key" ON "Operator"("username");

-- CreateIndex
CREATE INDEX "OperatorSession_operator_id_expires_at_idx" ON "OperatorSession"("operator_id", "expires_at");

-- CreateIndex
CREATE INDEX "OperatorSession_token_hash_idx" ON "OperatorSession"("token_hash");

-- CreateIndex
CREATE INDEX "OperatorPackBinding_pack_id_binding_type_idx" ON "OperatorPackBinding"("pack_id", "binding_type");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorPackBinding_operator_id_pack_id_key" ON "OperatorPackBinding"("operator_id", "pack_id");

-- CreateIndex
CREATE INDEX "OperatorGrant_receiver_identity_id_pack_id_idx" ON "OperatorGrant"("receiver_identity_id", "pack_id");

-- CreateIndex
CREATE INDEX "OperatorGrant_giver_operator_id_pack_id_idx" ON "OperatorGrant"("giver_operator_id", "pack_id");

-- CreateIndex
CREATE INDEX "OperatorAuditLog_operator_id_created_at_idx" ON "OperatorAuditLog"("operator_id", "created_at");

-- CreateIndex
CREATE INDEX "OperatorAuditLog_pack_id_action_created_at_idx" ON "OperatorAuditLog"("pack_id", "action", "created_at");
