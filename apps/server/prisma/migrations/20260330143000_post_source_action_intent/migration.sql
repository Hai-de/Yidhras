-- RedefineTable
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "author_id" TEXT NOT NULL,
    "source_action_intent_id" TEXT,
    "content" TEXT NOT NULL,
    "noise_level" REAL NOT NULL DEFAULT 0.0,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "Post_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Post_source_action_intent_id_fkey" FOREIGN KEY ("source_action_intent_id") REFERENCES "ActionIntent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Post" ("id", "author_id", "source_action_intent_id", "content", "noise_level", "is_encrypted", "created_at")
SELECT "id", "author_id", NULL, "content", "noise_level", "is_encrypted", "created_at" FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";

-- CreateIndex
CREATE INDEX "Post_source_action_intent_id_created_at_idx" ON "Post"("source_action_intent_id", "created_at");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
