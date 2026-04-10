-- CreateTable
CREATE TABLE "MemoryBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_agent_id" TEXT NOT NULL,
    "pack_id" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT,
    "content_text" TEXT NOT NULL,
    "content_structured" JSONB,
    "tags" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "source_ref" JSONB,
    "importance" REAL NOT NULL,
    "salience" REAL NOT NULL,
    "confidence" REAL,
    "created_at_tick" BIGINT NOT NULL,
    "updated_at_tick" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "MemoryBlockBehavior" (
    "memory_block_id" TEXT NOT NULL PRIMARY KEY,
    "behavior_json" JSONB NOT NULL,
    "created_at_tick" BIGINT NOT NULL,
    "updated_at_tick" BIGINT NOT NULL,
    CONSTRAINT "MemoryBlockBehavior_memory_block_id_fkey" FOREIGN KEY ("memory_block_id") REFERENCES "MemoryBlock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryBlockRuntimeState" (
    "memory_block_id" TEXT NOT NULL PRIMARY KEY,
    "trigger_count" INTEGER NOT NULL DEFAULT 0,
    "last_triggered_tick" BIGINT,
    "last_inserted_tick" BIGINT,
    "cooldown_until_tick" BIGINT,
    "delayed_until_tick" BIGINT,
    "retain_until_tick" BIGINT,
    "currently_active" BOOLEAN NOT NULL DEFAULT false,
    "last_activation_score" REAL,
    "recent_distance_from_latest_message" INTEGER,
    CONSTRAINT "MemoryBlockRuntimeState_memory_block_id_fkey" FOREIGN KEY ("memory_block_id") REFERENCES "MemoryBlock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryBlockDeletionAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memory_block_id" TEXT NOT NULL,
    "deleted_by" TEXT NOT NULL,
    "actor_id" TEXT,
    "reason" TEXT,
    "deleted_at_tick" BIGINT NOT NULL
);

-- CreateIndex
CREATE INDEX "MemoryBlock_owner_agent_id_updated_at_tick_idx" ON "MemoryBlock"("owner_agent_id", "updated_at_tick");

-- CreateIndex
CREATE INDEX "MemoryBlock_owner_agent_id_pack_id_status_idx" ON "MemoryBlock"("owner_agent_id", "pack_id", "status");

-- CreateIndex
CREATE INDEX "MemoryBlock_kind_status_idx" ON "MemoryBlock"("kind", "status");

-- CreateIndex
CREATE INDEX "MemoryBlockRuntimeState_currently_active_last_triggered_tick_idx" ON "MemoryBlockRuntimeState"("currently_active", "last_triggered_tick");

-- CreateIndex
CREATE INDEX "MemoryBlockDeletionAudit_memory_block_id_deleted_at_tick_idx" ON "MemoryBlockDeletionAudit"("memory_block_id", "deleted_at_tick");
