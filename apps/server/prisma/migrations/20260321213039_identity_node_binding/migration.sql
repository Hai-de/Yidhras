-- CreateTable
CREATE TABLE "IdentityNodeBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identity_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "atmosphere_node_id" TEXT,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" BIGINT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    CONSTRAINT "IdentityNodeBinding_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "Identity" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IdentityNodeBinding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "IdentityNodeBinding_atmosphere_node_id_fkey" FOREIGN KEY ("atmosphere_node_id") REFERENCES "AtmosphereNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "IdentityNodeBinding_identity_id_idx" ON "IdentityNodeBinding"("identity_id");

-- CreateIndex
CREATE INDEX "IdentityNodeBinding_agent_id_idx" ON "IdentityNodeBinding"("agent_id");

-- CreateIndex
CREATE INDEX "IdentityNodeBinding_atmosphere_node_id_idx" ON "IdentityNodeBinding"("atmosphere_node_id");

-- CreateIndex
CREATE INDEX "IdentityNodeBinding_role_status_idx" ON "IdentityNodeBinding"("role", "status");
