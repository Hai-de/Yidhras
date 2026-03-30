-- AlterTable
ALTER TABLE "DecisionJob" ADD COLUMN "locked_by" TEXT;
ALTER TABLE "DecisionJob" ADD COLUMN "locked_at" BIGINT;
ALTER TABLE "DecisionJob" ADD COLUMN "lock_expires_at" BIGINT;

-- CreateIndex
CREATE INDEX "DecisionJob_status_lock_expires_at_idx" ON "DecisionJob"("status", "lock_expires_at");
