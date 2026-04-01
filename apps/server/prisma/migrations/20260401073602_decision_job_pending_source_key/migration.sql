-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DecisionJob" (
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
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "completed_at" BIGINT,
    CONSTRAINT "DecisionJob_source_inference_id_fkey" FOREIGN KEY ("source_inference_id") REFERENCES "InferenceTrace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DecisionJob_replay_source_trace_id_fkey" FOREIGN KEY ("replay_source_trace_id") REFERENCES "InferenceTrace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DecisionJob_replay_of_job_id_fkey" FOREIGN KEY ("replay_of_job_id") REFERENCES "DecisionJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DecisionJob_action_intent_id_fkey" FOREIGN KEY ("action_intent_id") REFERENCES "ActionIntent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DecisionJob" ("action_intent_id", "attempt_count", "completed_at", "created_at", "id", "idempotency_key", "intent_class", "job_type", "last_error", "last_error_code", "last_error_stage", "lock_expires_at", "locked_at", "locked_by", "max_attempts", "next_retry_at", "pending_source_key", "replay_of_job_id", "replay_override_snapshot", "replay_reason", "replay_source_trace_id", "request_input", "scheduled_for_tick", "source_inference_id", "started_at", "status", "updated_at") SELECT "action_intent_id", "attempt_count", "completed_at", "created_at", "id", "idempotency_key", "intent_class", "job_type", "last_error", "last_error_code", "last_error_stage", "lock_expires_at", "locked_at", "locked_by", "max_attempts", "next_retry_at", "pending_source_key", "replay_of_job_id", "replay_override_snapshot", "replay_reason", "replay_source_trace_id", "request_input", "scheduled_for_tick", "source_inference_id", "started_at", "status", "updated_at" FROM "DecisionJob";
DROP TABLE "DecisionJob";
ALTER TABLE "new_DecisionJob" RENAME TO "DecisionJob";
CREATE UNIQUE INDEX "DecisionJob_source_inference_id_key" ON "DecisionJob"("source_inference_id");
CREATE UNIQUE INDEX "DecisionJob_action_intent_id_key" ON "DecisionJob"("action_intent_id");
CREATE UNIQUE INDEX "DecisionJob_idempotency_key_key" ON "DecisionJob"("idempotency_key");
CREATE UNIQUE INDEX "DecisionJob_pending_source_key_key" ON "DecisionJob"("pending_source_key");
CREATE INDEX "DecisionJob_status_created_at_idx" ON "DecisionJob"("status", "created_at");
CREATE INDEX "DecisionJob_status_lock_expires_at_idx" ON "DecisionJob"("status", "lock_expires_at");
CREATE INDEX "DecisionJob_status_scheduled_for_tick_idx" ON "DecisionJob"("status", "scheduled_for_tick");
CREATE INDEX "DecisionJob_intent_class_created_at_idx" ON "DecisionJob"("intent_class", "created_at");
CREATE INDEX "DecisionJob_replay_of_job_id_created_at_idx" ON "DecisionJob"("replay_of_job_id", "created_at");
CREATE TABLE "new_SchedulerCandidateDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduler_run_id" TEXT NOT NULL,
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
INSERT INTO "new_SchedulerCandidateDecision" ("actor_id", "candidate_reasons", "chosen_reason", "created_at", "created_job_id", "id", "kind", "priority_score", "scheduled_for_tick", "scheduler_run_id", "skipped_reason") SELECT "actor_id", "candidate_reasons", "chosen_reason", "created_at", "created_job_id", "id", "kind", "priority_score", "scheduled_for_tick", "scheduler_run_id", "skipped_reason" FROM "SchedulerCandidateDecision";
DROP TABLE "SchedulerCandidateDecision";
ALTER TABLE "new_SchedulerCandidateDecision" RENAME TO "SchedulerCandidateDecision";
CREATE INDEX "SchedulerCandidateDecision_scheduler_run_id_created_at_idx" ON "SchedulerCandidateDecision"("scheduler_run_id", "created_at");
CREATE INDEX "SchedulerCandidateDecision_actor_id_created_at_idx" ON "SchedulerCandidateDecision"("actor_id", "created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
