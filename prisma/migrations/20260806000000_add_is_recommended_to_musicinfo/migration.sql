-- AlterTable
ALTER TABLE "MusicInfo" ADD COLUMN "isRecommended" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "MusicInfo_isRecommended_idx" ON "MusicInfo"("isRecommended");
