CREATE TABLE "SchedulerRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "worker_id" TEXT NOT NULL,
    "tick" BIGINT NOT NULL,
    "summary" JSONB NOT NULL,
    "started_at" BIGINT NOT NULL,
    "finished_at" BIGINT NOT NULL,
    "created_at" BIGINT NOT NULL
);

CREATE TABLE "SchedulerCandidateDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduler_run_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "candidate_reasons" JSONB NOT NULL,
    "chosen_reason" TEXT NOT NULL,
    "scheduled_for_tick" BIGINT NOT NULL,
    "priority_score" INTEGER NOT NULL,
    "skipped_reason" TEXT,
    "created_job_id" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "SchedulerCandidateDecision_scheduler_run_id_fkey" FOREIGN KEY ("scheduler_run_id") REFERENCES "SchedulerRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SchedulerRun_tick_created_at_idx" ON "SchedulerRun"("tick", "created_at");
CREATE INDEX "SchedulerCandidateDecision_scheduler_run_id_created_at_idx" ON "SchedulerCandidateDecision"("scheduler_run_id", "created_at");
CREATE INDEX "SchedulerCandidateDecision_actor_id_created_at_idx" ON "SchedulerCandidateDecision"("actor_id", "created_at");
