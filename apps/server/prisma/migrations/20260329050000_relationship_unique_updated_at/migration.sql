-- Deduplicate existing relationship rows by keeping the latest created_at per (from_id, to_id, type)
DELETE FROM "Relationship"
WHERE "id" NOT IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "from_id", "to_id", "type"
        ORDER BY "created_at" DESC, "id" DESC
      ) AS rn
    FROM "Relationship"
  ) ranked
  WHERE ranked.rn = 1
);

-- RedefineTable
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Relationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "from_id" TEXT NOT NULL,
    "to_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1.0,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "Relationship_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Relationship_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Relationship" (
    "id",
    "from_id",
    "to_id",
    "type",
    "weight",
    "created_at",
    "updated_at"
)
SELECT
    "id",
    "from_id",
    "to_id",
    "type",
    "weight",
    "created_at",
    "created_at"
FROM "Relationship";
DROP TABLE "Relationship";
ALTER TABLE "new_Relationship" RENAME TO "Relationship";
CREATE UNIQUE INDEX "Relationship_from_id_to_id_type_key" ON "Relationship"("from_id", "to_id", "type");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
