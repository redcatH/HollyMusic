-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RecommendTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "taskType" TEXT NOT NULL DEFAULT 'artists',
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
INSERT INTO "new_RecommendTask" ("artistsJson", "configJson", "createdAt", "createdBy", "error", "finishedAt", "id", "name", "progressJson", "startedAt", "status") SELECT "artistsJson", "configJson", "createdAt", "createdBy", "error", "finishedAt", "id", "name", "progressJson", "startedAt", "status" FROM "RecommendTask";
DROP TABLE "RecommendTask";
ALTER TABLE "new_RecommendTask" RENAME TO "RecommendTask";
CREATE INDEX "RecommendTask_status_idx" ON "RecommendTask"("status");
CREATE INDEX "RecommendTask_createdAt_idx" ON "RecommendTask"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
