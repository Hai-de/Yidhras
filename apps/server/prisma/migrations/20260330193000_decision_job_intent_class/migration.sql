ALTER TABLE "DecisionJob" ADD COLUMN "intent_class" TEXT NOT NULL DEFAULT 'direct_inference';

CREATE INDEX "DecisionJob_intent_class_created_at_idx" ON "DecisionJob"("intent_class", "created_at");
