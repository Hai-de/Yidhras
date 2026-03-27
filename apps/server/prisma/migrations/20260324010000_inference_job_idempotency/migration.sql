-- RedefineTable
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DecisionJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_inference_id" TEXT NOT NULL,
    "action_intent_id" TEXT,
    "job_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "max_attempts" INTEGER NOT NULL DEFAULT 1,
    "last_error" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "completed_at" BIGINT,
    CONSTRAINT "DecisionJob_source_inference_id_fkey" FOREIGN KEY ("source_inference_id") REFERENCES "InferenceTrace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DecisionJob_action_intent_id_fkey" FOREIGN KEY ("action_intent_id") REFERENCES "ActionIntent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DecisionJob" (
    "action_intent_id",
    "attempt_count",
    "completed_at",
    "created_at",
    "id",
    "job_type",
    "last_error",
    "max_attempts",
    "source_inference_id",
    "status",
    "updated_at"
)
SELECT
    "action_intent_id",
    "attempt_count",
    "completed_at",
    "created_at",
    "id",
    "job_type",
    "last_error",
    "max_attempts",
    "source_inference_id",
    "status",
    "updated_at"
FROM "DecisionJob";
DROP TABLE "DecisionJob";
ALTER TABLE "new_DecisionJob" RENAME TO "DecisionJob";
CREATE UNIQUE INDEX "DecisionJob_source_inference_id_key" ON "DecisionJob"("source_inference_id");
CREATE UNIQUE INDEX "DecisionJob_action_intent_id_key" ON "DecisionJob"("action_intent_id");
CREATE UNIQUE INDEX "DecisionJob_idempotency_key_key" ON "DecisionJob"("idempotency_key");
CREATE INDEX "DecisionJob_status_created_at_idx" ON "DecisionJob"("status", "created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
