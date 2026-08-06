-- CreateTable
CREATE TABLE "RecommendTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "artistsJson" TEXT NOT NULL,
    "configJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progressJson" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "RecommendTask_status_idx" ON "RecommendTask"("status");

-- CreateIndex
CREATE INDEX "RecommendTask_createdAt_idx" ON "RecommendTask"("createdAt");
