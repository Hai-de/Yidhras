-- CreateTable
CREATE TABLE "ConversationMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_agent_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "summary" TEXT,
    "metadata_json" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "ConversationEntryRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memory_id" TEXT NOT NULL,
    "turn_number" INTEGER NOT NULL,
    "speaker_agent_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'original',
    "original_content" TEXT NOT NULL,
    "current_content" TEXT NOT NULL,
    "provenance_json" TEXT NOT NULL,
    "modifications_json" TEXT NOT NULL DEFAULT '[]',
    "recorded_at" BIGINT NOT NULL,
    "source_inference_id" TEXT,
    "derived_from_entry_ids_json" TEXT,
    "turn_range_start" INTEGER,
    "turn_range_end" INTEGER,
    "tool_trace_json" TEXT,
    "tags_json" TEXT,
    "metadata_json" TEXT,
    CONSTRAINT "ConversationEntryRecord_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "ConversationMemory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMemory_owner_agent_id_conversation_id_key" ON "ConversationMemory"("owner_agent_id", "conversation_id");

-- CreateIndex
CREATE INDEX "ConversationEntryRecord_memory_id_turn_number_idx" ON "ConversationEntryRecord"("memory_id", "turn_number");
