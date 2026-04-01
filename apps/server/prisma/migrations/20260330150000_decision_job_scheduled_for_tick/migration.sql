ALTER TABLE "DecisionJob" ADD COLUMN "scheduled_for_tick" BIGINT;

CREATE INDEX "DecisionJob_status_scheduled_for_tick_idx" ON "DecisionJob"("status", "scheduled_for_tick");
