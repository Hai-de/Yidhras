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
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "ActionIntent_source_inference_id_fkey" FOREIGN KEY ("source_inference_id") REFERENCES "InferenceTrace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DecisionJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_inference_id" TEXT NOT NULL,
    "action_intent_id" TEXT,
    "job_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "max_attempts" INTEGER NOT NULL DEFAULT 1,
    "last_error" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "completed_at" BIGINT,
    CONSTRAINT "DecisionJob_source_inference_id_fkey" FOREIGN KEY ("source_inference_id") REFERENCES "InferenceTrace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DecisionJob_action_intent_id_fkey" FOREIGN KEY ("action_intent_id") REFERENCES "ActionIntent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "InferenceTrace_kind_created_at_idx" ON "InferenceTrace"("kind", "created_at");

-- CreateIndex
CREATE INDEX "InferenceTrace_strategy_provider_idx" ON "InferenceTrace"("strategy", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ActionIntent_source_inference_id_key" ON "ActionIntent"("source_inference_id");

-- CreateIndex
CREATE INDEX "ActionIntent_status_created_at_idx" ON "ActionIntent"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionJob_source_inference_id_key" ON "DecisionJob"("source_inference_id");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionJob_action_intent_id_key" ON "DecisionJob"("action_intent_id");

-- CreateIndex
CREATE INDEX "DecisionJob_status_created_at_idx" ON "DecisionJob"("status", "created_at");
