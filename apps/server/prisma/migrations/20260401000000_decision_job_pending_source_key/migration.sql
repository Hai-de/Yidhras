-- AlterTable
ALTER TABLE "DecisionJob" ADD COLUMN "pending_source_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DecisionJob_pending_source_key_key" ON "DecisionJob"("pending_source_key");
