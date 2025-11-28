-- CreateTable
CREATE TABLE "MusicInfo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "songmid" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "MusicInfo_songmid_idx" ON "MusicInfo"("songmid");

-- CreateIndex
CREATE UNIQUE INDEX "MusicInfo_source_songmid_key" ON "MusicInfo"("source", "songmid");
