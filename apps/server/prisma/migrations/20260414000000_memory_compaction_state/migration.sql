-- CreateTable
CREATE TABLE "MemoryCompactionState" (
    "agent_id" TEXT NOT NULL PRIMARY KEY,
    "pack_id" TEXT,
    "inference_count_since_summary" INTEGER NOT NULL DEFAULT 0,
    "inference_count_since_compaction" INTEGER NOT NULL DEFAULT 0,
    "last_summary_tick" BIGINT,
    "last_compaction_tick" BIGINT,
    "updated_at_tick" BIGINT NOT NULL
);

-- CreateIndex
CREATE INDEX "MemoryCompactionState_pack_id_updated_at_tick_idx" ON "MemoryCompactionState"("pack_id", "updated_at_tick");
