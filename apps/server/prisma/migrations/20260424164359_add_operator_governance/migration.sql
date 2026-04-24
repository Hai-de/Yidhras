-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identity_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_root" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "display_name" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "Operator_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "Identity" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OperatorSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operator_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "pack_id" TEXT,
    "expires_at" BIGINT NOT NULL,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "OperatorSession_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "Operator" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OperatorPackBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operator_id" TEXT NOT NULL,
    "pack_id" TEXT NOT NULL,
    "binding_type" TEXT NOT NULL DEFAULT 'member',
    "bound_at" BIGINT NOT NULL,
    "bound_by" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "OperatorPackBinding_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "Operator" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OperatorGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "giver_operator_id" TEXT NOT NULL,
    "receiver_identity_id" TEXT NOT NULL,
    "pack_id" TEXT NOT NULL,
    "capability_key" TEXT NOT NULL,
    "scope_json" JSONB,
    "revocable" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" BIGINT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "OperatorGrant_giver_operator_id_fkey" FOREIGN KEY ("giver_operator_id") REFERENCES "Operator" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OperatorAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operator_id" TEXT,
    "pack_id" TEXT,
    "action" TEXT NOT NULL,
    "target_id" TEXT,
    "detail_json" JSONB,
    "client_ip" TEXT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "OperatorAuditLog_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "Operator" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Operator_identity_id_key" ON "Operator"("identity_id");

-- CreateIndex
CREATE UNIQUE INDEX "Operator_username_key" ON "Operator"("username");

-- CreateIndex
CREATE INDEX "OperatorSession_operator_id_expires_at_idx" ON "OperatorSession"("operator_id", "expires_at");

-- CreateIndex
CREATE INDEX "OperatorSession_token_hash_idx" ON "OperatorSession"("token_hash");

-- CreateIndex
CREATE INDEX "OperatorPackBinding_pack_id_binding_type_idx" ON "OperatorPackBinding"("pack_id", "binding_type");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorPackBinding_operator_id_pack_id_key" ON "OperatorPackBinding"("operator_id", "pack_id");

-- CreateIndex
CREATE INDEX "OperatorGrant_receiver_identity_id_pack_id_idx" ON "OperatorGrant"("receiver_identity_id", "pack_id");

-- CreateIndex
CREATE INDEX "OperatorGrant_giver_operator_id_pack_id_idx" ON "OperatorGrant"("giver_operator_id", "pack_id");

-- CreateIndex
CREATE INDEX "OperatorAuditLog_operator_id_created_at_idx" ON "OperatorAuditLog"("operator_id", "created_at");

-- CreateIndex
CREATE INDEX "OperatorAuditLog_pack_id_action_created_at_idx" ON "OperatorAuditLog"("pack_id", "action", "created_at");
