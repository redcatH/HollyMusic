-- CreateTable
CREATE TABLE "AudioCache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cacheKey" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "size" INTEGER,
    "downloadedBytes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'downloading',
    "contentType" TEXT,
    "quality" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "lastAccessAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AudioCache_cacheKey_key" ON "AudioCache"("cacheKey");

-- CreateIndex
CREATE INDEX "AudioCache_status_idx" ON "AudioCache"("status");

-- CreateIndex
CREATE INDEX "AudioCache_lastAccessAt_idx" ON "AudioCache"("lastAccessAt");

-- CreateIndex
CREATE INDEX "AudioCache_uid_idx" ON "AudioCache"("uid");
