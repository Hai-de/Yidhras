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

-- CreateIndex
CREATE INDEX "AiInvocationRecord_source_inference_id_created_at_idx" ON "AiInvocationRecord"("source_inference_id", "created_at");

-- CreateIndex
CREATE INDEX "AiInvocationRecord_task_type_created_at_idx" ON "AiInvocationRecord"("task_type", "created_at");

-- CreateIndex
CREATE INDEX "AiInvocationRecord_provider_model_created_at_idx" ON "AiInvocationRecord"("provider", "model", "created_at");

-- CreateIndex
CREATE INDEX "AiInvocationRecord_status_created_at_idx" ON "AiInvocationRecord"("status", "created_at");
