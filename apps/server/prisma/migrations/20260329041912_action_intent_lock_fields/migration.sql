-- AlterTable
ALTER TABLE "ActionIntent" ADD COLUMN "locked_by" TEXT;
ALTER TABLE "ActionIntent" ADD COLUMN "locked_at" BIGINT;
ALTER TABLE "ActionIntent" ADD COLUMN "lock_expires_at" BIGINT;

-- CreateIndex
CREATE INDEX "ActionIntent_status_lock_expires_at_idx" ON "ActionIntent"("status", "lock_expires_at");
