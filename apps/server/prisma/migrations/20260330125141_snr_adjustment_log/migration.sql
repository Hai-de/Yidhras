-- CreateTable
CREATE TABLE "SNRAdjustmentLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action_intent_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requested_value" REAL NOT NULL,
    "baseline_value" REAL NOT NULL,
    "resolved_value" REAL NOT NULL,
    "reason" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "SNRAdjustmentLog_action_intent_id_fkey" FOREIGN KEY ("action_intent_id") REFERENCES "ActionIntent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SNRAdjustmentLog_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SNRAdjustmentLog_action_intent_id_created_at_idx" ON "SNRAdjustmentLog"("action_intent_id", "created_at");
CREATE INDEX "SNRAdjustmentLog_agent_id_created_at_idx" ON "SNRAdjustmentLog"("agent_id", "created_at");
