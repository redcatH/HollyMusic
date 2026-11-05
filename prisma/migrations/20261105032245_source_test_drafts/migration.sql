-- CreateTable
CREATE TABLE "SourceTestDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "stateJson" TEXT NOT NULL,
    "privateJson" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "SourceTestDraft_ownerId_expiresAt_idx" ON "SourceTestDraft"("ownerId", "expiresAt");
