-- AlterTable
ALTER TABLE "ActionIntent" ADD COLUMN "pack_id" TEXT;

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "pack_id" TEXT;

-- AlterTable
ALTER TABLE "AiInvocationRecord" ADD COLUMN "pack_id" TEXT;

-- AlterTable
ALTER TABLE "AtmosphereNode" ADD COLUMN "pack_id" TEXT;

-- AlterTable
ALTER TABLE "Circle" ADD COLUMN "pack_id" TEXT;

-- AlterTable
ALTER TABLE "CircleMember" ADD COLUMN "pack_id" TEXT;

-- AlterTable
ALTER TABLE "ConversationMemory" ADD COLUMN "pack_id" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "pack_id" TEXT;

-- AlterTable
ALTER TABLE "Identity" ADD COLUMN "pack_id" TEXT;

-- AlterTable
ALTER TABLE "InferenceTrace" ADD COLUMN "pack_id" TEXT;

-- AlterTable
ALTER TABLE "Policy" ADD COLUMN "pack_id" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "pack_id" TEXT;

-- AlterTable
ALTER TABLE "Relationship" ADD COLUMN "pack_id" TEXT;

-- AlterTable
ALTER TABLE "RelationshipAdjustmentLog" ADD COLUMN "pack_id" TEXT;

-- AlterTable
ALTER TABLE "SNRAdjustmentLog" ADD COLUMN "pack_id" TEXT;

-- AlterTable
ALTER TABLE "WorldVariable" ADD COLUMN "pack_id" TEXT;

-- CreateIndex
CREATE INDEX "ActionIntent_pack_id_status_idx" ON "ActionIntent"("pack_id", "status");

-- CreateIndex
CREATE INDEX "Agent_pack_id_type_idx" ON "Agent"("pack_id", "type");

-- CreateIndex
CREATE INDEX "AiInvocationRecord_pack_id_created_at_idx" ON "AiInvocationRecord"("pack_id", "created_at");

-- CreateIndex
CREATE INDEX "AtmosphereNode_pack_id_idx" ON "AtmosphereNode"("pack_id");

-- CreateIndex
CREATE INDEX "Circle_pack_id_idx" ON "Circle"("pack_id");

-- CreateIndex
CREATE INDEX "CircleMember_pack_id_idx" ON "CircleMember"("pack_id");

-- CreateIndex
CREATE INDEX "ConversationMemory_pack_id_idx" ON "ConversationMemory"("pack_id");

-- CreateIndex
CREATE INDEX "Event_pack_id_tick_idx" ON "Event"("pack_id", "tick");

-- CreateIndex
CREATE INDEX "Identity_pack_id_idx" ON "Identity"("pack_id");

-- CreateIndex
CREATE INDEX "InferenceTrace_pack_id_created_at_idx" ON "InferenceTrace"("pack_id", "created_at");

-- CreateIndex
CREATE INDEX "Policy_pack_id_resource_action_idx" ON "Policy"("pack_id", "resource", "action");

-- CreateIndex
CREATE INDEX "Post_pack_id_idx" ON "Post"("pack_id");

-- CreateIndex
CREATE INDEX "Relationship_pack_id_from_id_idx" ON "Relationship"("pack_id", "from_id");

-- CreateIndex
CREATE INDEX "RelationshipAdjustmentLog_pack_id_created_at_idx" ON "RelationshipAdjustmentLog"("pack_id", "created_at");

-- CreateIndex
CREATE INDEX "SNRAdjustmentLog_pack_id_agent_id_idx" ON "SNRAdjustmentLog"("pack_id", "agent_id");

-- CreateIndex
CREATE INDEX "WorldVariable_pack_id_key_idx" ON "WorldVariable"("pack_id", "key");
