-- CreateTable
CREATE TABLE "ContextOverlayEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_id" TEXT NOT NULL,
    "pack_id" TEXT,
    "overlay_type" TEXT NOT NULL,
    "title" TEXT,
    "content_text" TEXT NOT NULL,
    "content_structured" JSONB,
    "tags" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "persistence_mode" TEXT NOT NULL,
    "source_node_ids" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at_tick" BIGINT NOT NULL,
    "updated_at_tick" BIGINT NOT NULL
);

-- CreateIndex
CREATE INDEX "ContextOverlayEntry_actor_id_updated_at_tick_idx" ON "ContextOverlayEntry"("actor_id", "updated_at_tick");

-- CreateIndex
CREATE INDEX "ContextOverlayEntry_actor_id_pack_id_status_idx" ON "ContextOverlayEntry"("actor_id", "pack_id", "status");

-- CreateIndex
CREATE INDEX "ContextOverlayEntry_overlay_type_status_idx" ON "ContextOverlayEntry"("overlay_type", "status");
