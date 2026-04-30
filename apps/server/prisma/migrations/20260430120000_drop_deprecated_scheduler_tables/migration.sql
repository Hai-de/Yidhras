-- Drop deprecated scheduler tables migrated to per-pack SQLite (SchedulerStorageAdapter)
DROP TABLE IF EXISTS SchedulerCandidateDecision;
DROP TABLE IF EXISTS SchedulerRun;
DROP TABLE IF EXISTS SchedulerRebalanceRecommendation;
DROP TABLE IF EXISTS SchedulerWorkerRuntimeState;
DROP TABLE IF EXISTS SchedulerOwnershipMigrationLog;
DROP TABLE IF EXISTS SchedulerPartitionAssignment;
DROP TABLE IF EXISTS SchedulerCursor;
DROP TABLE IF EXISTS SchedulerLease;
