CREATE TABLE "SchedulerLease" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "holder" TEXT NOT NULL,
    "acquired_at" BIGINT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL
);

CREATE TABLE "SchedulerCursor" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "last_scanned_tick" BIGINT NOT NULL,
    "last_signal_tick" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL
);
