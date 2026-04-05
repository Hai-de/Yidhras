CREATE TABLE "ScenarioEntityState" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "pack_id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "state_json" JSONB NOT NULL,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL
);

CREATE UNIQUE INDEX "ScenarioEntityState_pack_id_entity_type_entity_id_key"
ON "ScenarioEntityState"("pack_id", "entity_type", "entity_id");

CREATE INDEX "ScenarioEntityState_pack_id_entity_type_idx"
ON "ScenarioEntityState"("pack_id", "entity_type");

CREATE INDEX "ScenarioEntityState_entity_type_entity_id_idx"
ON "ScenarioEntityState"("entity_type", "entity_id");
