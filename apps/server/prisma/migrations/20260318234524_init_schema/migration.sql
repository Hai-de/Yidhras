-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "snr" REAL NOT NULL DEFAULT 0.5,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "AtmosphereNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "expires_at" BIGINT,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "AtmosphereNode_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Circle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "CircleMember" (
    "agent_id" TEXT NOT NULL,
    "circle_id" TEXT NOT NULL,

    PRIMARY KEY ("agent_id", "circle_id"),
    CONSTRAINT "CircleMember_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CircleMember_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "Circle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "from_id" TEXT NOT NULL,
    "to_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1.0,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "Relationship_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Relationship_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "author_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "noise_level" REAL NOT NULL DEFAULT 0.0,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" BIGINT NOT NULL,
    CONSTRAINT "Post_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tick" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "impact_data" TEXT
);

-- CreateTable
CREATE TABLE "WorldVariable" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL
);
