-- CreateTable
CREATE TABLE "Identity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'm2',
    "status" TEXT NOT NULL DEFAULT 'active',
    "claims" JSONB,
    "metadata" JSONB,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "effect" TEXT NOT NULL,
    "subject_id" TEXT,
    "subject_type" TEXT,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "conditions" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "Policy_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "Identity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Policy_resource_action_idx" ON "Policy"("resource", "action");

-- CreateIndex
CREATE INDEX "Policy_subject_id_idx" ON "Policy"("subject_id");

-- CreateIndex
CREATE INDEX "Policy_subject_type_idx" ON "Policy"("subject_type");
