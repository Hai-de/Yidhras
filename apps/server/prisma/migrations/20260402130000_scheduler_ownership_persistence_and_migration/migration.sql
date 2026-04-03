CREATE TABLE "SchedulerPartitionAssignment" (
    "partition_id" TEXT NOT NULL PRIMARY KEY,
    "worker_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'released',
    "version" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'bootstrap',
    "updated_at" BIGINT NOT NULL
);

CREATE INDEX "SchedulerPartitionAssignment_worker_id_updated_at_idx" ON "SchedulerPartitionAssignment"("worker_id", "updated_at");
CREATE INDEX "SchedulerPartitionAssignment_status_updated_at_idx" ON "SchedulerPartitionAssignment"("status", "updated_at");

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

CREATE INDEX "SchedulerOwnershipMigrationLog_partition_id_created_at_idx" ON "SchedulerOwnershipMigrationLog"("partition_id", "created_at");
CREATE INDEX "SchedulerOwnershipMigrationLog_to_worker_id_created_at_idx" ON "SchedulerOwnershipMigrationLog"("to_worker_id", "created_at");
CREATE INDEX "SchedulerOwnershipMigrationLog_status_created_at_idx" ON "SchedulerOwnershipMigrationLog"("status", "created_at");
