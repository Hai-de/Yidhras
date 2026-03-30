-- AlterTable
ALTER TABLE "DecisionJob" ADD COLUMN "replay_of_job_id" TEXT;
ALTER TABLE "DecisionJob" ADD COLUMN "replay_source_trace_id" TEXT;
ALTER TABLE "DecisionJob" ADD COLUMN "replay_reason" TEXT;

-- CreateIndex
CREATE INDEX "DecisionJob_replay_of_job_id_created_at_idx" ON "DecisionJob"("replay_of_job_id", "created_at");
