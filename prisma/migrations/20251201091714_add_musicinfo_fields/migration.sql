-- AlterTable
ALTER TABLE "MusicInfo" ADD COLUMN "albumId" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "albumMid" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "albumName" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "copyrightId" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "durationSeconds" INTEGER;
ALTER TABLE "MusicInfo" ADD COLUMN "hash" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "img" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "lrc" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "lrcUrl" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "mrcUrl" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "name" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "singer" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "songId" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "strMediaMid" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "trcUrl" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "typeUrlJson" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "typesJson" TEXT;
ALTER TABLE "MusicInfo" ADD COLUMN "typesMapJson" TEXT;

-- CreateIndex
CREATE INDEX "MusicInfo_name_idx" ON "MusicInfo"("name");

-- CreateIndex
CREATE INDEX "MusicInfo_singer_idx" ON "MusicInfo"("singer");

-- CreateIndex
CREATE INDEX "MusicInfo_albumId_idx" ON "MusicInfo"("albumId");

-- CreateIndex
CREATE INDEX "MusicInfo_albumName_idx" ON "MusicInfo"("albumName");

-- CreateIndex
CREATE INDEX "MusicInfo_songId_idx" ON "MusicInfo"("songId");
