-- CreateTable
CREATE TABLE "RelationshipAdjustmentLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action_intent_id" TEXT NOT NULL,
    "relationship_id" TEXT NOT NULL,
    "from_id" TEXT NOT NULL,
    "to_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "old_weight" REAL,
    "new_weight" REAL NOT NULL,
    "reason" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "RelationshipAdjustmentLog_action_intent_id_fkey" FOREIGN KEY ("action_intent_id") REFERENCES "ActionIntent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RelationshipAdjustmentLog_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "Relationship" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RelationshipAdjustmentLog_action_intent_id_created_at_idx" ON "RelationshipAdjustmentLog"("action_intent_id", "created_at");
CREATE INDEX "RelationshipAdjustmentLog_relationship_id_created_at_idx" ON "RelationshipAdjustmentLog"("relationship_id", "created_at");
CREATE INDEX "RelationshipAdjustmentLog_from_id_to_id_type_created_at_idx" ON "RelationshipAdjustmentLog"("from_id", "to_id", "type", "created_at");
