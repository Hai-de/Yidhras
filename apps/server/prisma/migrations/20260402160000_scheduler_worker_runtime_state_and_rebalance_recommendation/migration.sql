CREATE TABLE "SchedulerWorkerRuntimeState" (
  "worker_id" TEXT NOT NULL PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'active',
  "last_heartbeat_at" BIGINT NOT NULL,
  "owned_partition_count" INTEGER NOT NULL DEFAULT 0,
  "active_migration_count" INTEGER NOT NULL DEFAULT 0,
  "capacity_hint" INTEGER,
  "updated_at" BIGINT NOT NULL
);

CREATE INDEX "SchedulerWorkerRuntimeState_status_updated_at_idx"
ON "SchedulerWorkerRuntimeState"("status", "updated_at");

CREATE INDEX "SchedulerWorkerRuntimeState_last_heartbeat_at_idx"
ON "SchedulerWorkerRuntimeState"("last_heartbeat_at");

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

CREATE INDEX "SchedulerRebalanceRecommendation_status_created_at_idx"
ON "SchedulerRebalanceRecommendation"("status", "created_at");

CREATE INDEX "SchedulerRebalanceRecommendation_partition_id_created_at_idx"
ON "SchedulerRebalanceRecommendation"("partition_id", "created_at");
