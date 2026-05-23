-- AlterTable
ALTER TABLE "ActionIntent" ADD COLUMN "source_workflow_run_id" TEXT;
ALTER TABLE "ActionIntent" ADD COLUMN "source_workflow_step_id" TEXT;
ALTER TABLE "ActionIntent" ADD COLUMN "source_step_attempt" INTEGER;

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflow_name" TEXT NOT NULL,
    "pack_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_tick" BIGINT NOT NULL,
    "last_advance_tick" BIGINT NOT NULL,
    "max_ticks" INTEGER NOT NULL,
    "trigger_type" TEXT NOT NULL,
    "trigger_ref" TEXT,
    "lock_worker_id" TEXT,
    "lock_expires_at" BIGINT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "WorkflowStepRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflow_run_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "partition_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "dependency_step_ids" JSONB NOT NULL,
    "input_step_ids" JSONB NOT NULL,
    "result_json" JSONB,
    "error_json" JSONB,
    "action_intent_ids" JSONB NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "started_tick" BIGINT,
    "completed_tick" BIGINT,
    "lock_worker_id" TEXT,
    "lock_expires_at" BIGINT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "WorkflowStepRun_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "WorkflowRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ActionIntent_source_workflow_run_id_idx" ON "ActionIntent"("source_workflow_run_id");

-- CreateIndex
CREATE INDEX "ActionIntent_source_workflow_step_id_idx" ON "ActionIntent"("source_workflow_step_id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_idempotency_key_key" ON "WorkflowRun"("idempotency_key");

-- CreateIndex
CREATE INDEX "WorkflowRun_pack_id_status_idx" ON "WorkflowRun"("pack_id", "status");

-- CreateIndex
CREATE INDEX "WorkflowRun_status_lock_expires_at_idx" ON "WorkflowRun"("status", "lock_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStepRun_idempotency_key_key" ON "WorkflowStepRun"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStepRun_workflow_run_id_step_id_attempt_key" ON "WorkflowStepRun"("workflow_run_id", "step_id", "attempt");

-- CreateIndex
CREATE INDEX "WorkflowStepRun_workflow_run_id_status_idx" ON "WorkflowStepRun"("workflow_run_id", "status");

-- CreateIndex
CREATE INDEX "WorkflowStepRun_agent_id_status_idx" ON "WorkflowStepRun"("agent_id", "status");

-- CreateIndex
CREATE INDEX "WorkflowStepRun_status_lock_expires_at_idx" ON "WorkflowStepRun"("status", "lock_expires_at");
