ALTER TABLE "SchedulerRun" ADD COLUMN "partition_id" TEXT NOT NULL DEFAULT 'p0';
ALTER TABLE "SchedulerRun" ADD COLUMN "lease_holder" TEXT;
ALTER TABLE "SchedulerRun" ADD COLUMN "lease_expires_at_snapshot" BIGINT;

ALTER TABLE "SchedulerCandidateDecision" ADD COLUMN "partition_id" TEXT NOT NULL DEFAULT 'p0';

ALTER TABLE "SchedulerLease" ADD COLUMN "partition_id" TEXT NOT NULL DEFAULT 'p0';
ALTER TABLE "SchedulerCursor" ADD COLUMN "partition_id" TEXT NOT NULL DEFAULT 'p0';

UPDATE "SchedulerLease" SET "partition_id" = 'p0' WHERE "partition_id" IS NULL OR "partition_id" = '';
UPDATE "SchedulerCursor" SET "partition_id" = 'p0' WHERE "partition_id" IS NULL OR "partition_id" = '';
UPDATE "SchedulerRun" SET "partition_id" = 'p0' WHERE "partition_id" IS NULL OR "partition_id" = '';
UPDATE "SchedulerCandidateDecision" SET "partition_id" = 'p0' WHERE "partition_id" IS NULL OR "partition_id" = '';

CREATE UNIQUE INDEX "SchedulerLease_partition_id_key" ON "SchedulerLease"("partition_id");
CREATE INDEX "SchedulerLease_partition_id_expires_at_idx" ON "SchedulerLease"("partition_id", "expires_at");
CREATE UNIQUE INDEX "SchedulerCursor_partition_id_key" ON "SchedulerCursor"("partition_id");
CREATE INDEX "SchedulerRun_partition_id_created_at_idx" ON "SchedulerRun"("partition_id", "created_at");
CREATE INDEX "SchedulerCandidateDecision_partition_id_created_at_idx" ON "SchedulerCandidateDecision"("partition_id", "created_at");
