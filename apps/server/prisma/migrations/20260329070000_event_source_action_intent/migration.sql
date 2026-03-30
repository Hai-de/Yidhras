-- RedefineTable
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tick" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "impact_data" TEXT,
    "source_action_intent_id" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "Event_source_action_intent_id_fkey" FOREIGN KEY ("source_action_intent_id") REFERENCES "ActionIntent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Event" (
    "id",
    "title",
    "description",
    "tick",
    "type",
    "impact_data",
    "created_at"
)
SELECT
    "id",
    "title",
    "description",
    "tick",
    "type",
    "impact_data",
    "tick"
FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE INDEX "Event_tick_idx" ON "Event"("tick");
CREATE INDEX "Event_type_tick_idx" ON "Event"("type", "tick");
CREATE INDEX "Event_source_action_intent_id_tick_idx" ON "Event"("source_action_intent_id", "tick");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
