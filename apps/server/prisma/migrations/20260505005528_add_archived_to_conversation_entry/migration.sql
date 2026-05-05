-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ConversationEntryRecord" (
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
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "tags_json" TEXT,
    "metadata_json" TEXT,
    CONSTRAINT "ConversationEntryRecord_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "ConversationMemory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ConversationEntryRecord" ("current_content", "derived_from_entry_ids_json", "id", "kind", "memory_id", "metadata_json", "modifications_json", "original_content", "provenance_json", "recorded_at", "source_inference_id", "speaker_agent_id", "tags_json", "tool_trace_json", "turn_number", "turn_range_end", "turn_range_start") SELECT "current_content", "derived_from_entry_ids_json", "id", "kind", "memory_id", "metadata_json", "modifications_json", "original_content", "provenance_json", "recorded_at", "source_inference_id", "speaker_agent_id", "tags_json", "tool_trace_json", "turn_number", "turn_range_end", "turn_range_start" FROM "ConversationEntryRecord";
DROP TABLE "ConversationEntryRecord";
ALTER TABLE "new_ConversationEntryRecord" RENAME TO "ConversationEntryRecord";
CREATE INDEX "ConversationEntryRecord_memory_id_turn_number_idx" ON "ConversationEntryRecord"("memory_id", "turn_number");
CREATE UNIQUE INDEX "ConversationEntryRecord_memory_id_turn_number_key" ON "ConversationEntryRecord"("memory_id", "turn_number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
