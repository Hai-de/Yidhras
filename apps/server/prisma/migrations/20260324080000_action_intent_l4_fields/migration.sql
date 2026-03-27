-- RedefineTable
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ActionIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_inference_id" TEXT NOT NULL,
    "intent_type" TEXT NOT NULL,
    "actor_ref" JSONB NOT NULL,
    "target_ref" JSONB,
    "payload" JSONB NOT NULL,
    "scheduled_after_ticks" BIGINT,
    "scheduled_for_tick" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dispatch_started_at" BIGINT,
    "dispatched_at" BIGINT,
    "transmission_delay_ticks" BIGINT,
    "transmission_drop_chance" REAL NOT NULL DEFAULT 0,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "ActionIntent_source_inference_id_fkey" FOREIGN KEY ("source_inference_id") REFERENCES "InferenceTrace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ActionIntent" (
    "actor_ref",
    "created_at",
    "dispatch_started_at",
    "dispatched_at",
    "id",
    "intent_type",
    "payload",
    "scheduled_after_ticks",
    "scheduled_for_tick",
    "source_inference_id",
    "status",
    "target_ref",
    "updated_at"
)
SELECT
    "actor_ref",
    "created_at",
    "dispatch_started_at",
    "dispatched_at",
    "id",
    "intent_type",
    "payload",
    "scheduled_after_ticks",
    "scheduled_for_tick",
    "source_inference_id",
    "status",
    "target_ref",
    "updated_at"
FROM "ActionIntent";
DROP TABLE "ActionIntent";
ALTER TABLE "new_ActionIntent" RENAME TO "ActionIntent";
CREATE UNIQUE INDEX "ActionIntent_source_inference_id_key" ON "ActionIntent"("source_inference_id");
CREATE INDEX "ActionIntent_status_created_at_idx" ON "ActionIntent"("status", "created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
