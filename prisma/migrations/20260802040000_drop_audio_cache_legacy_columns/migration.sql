-- Migration: drop_audio_cache_legacy_columns
-- 修复 schema drift：实际 DB 表仍保留旧设计的 quality/uid/status/downloadedBytes/createdAt/updatedAt 列，
-- 而 schema.prisma 已精简为 6 列（cacheKey 已编码 quality，DB 只记「已完成」文件元数据）。
-- 现象：runDownload 完成后 prisma.audioCache.upsert 不传 quality → P2011 Null constraint violation。
--
-- 为什么重建表而不是 DROP COLUMN：
--   1. SQLite 的 ALTER TABLE DROP COLUMN 不能删带索引的列（uid/status 各自带索引）
--   2. 一次 DROP 多列要多次 ALTER，且 SQLite < 3.35 根本不支持 DROP COLUMN
--   3. AudioCache 是缓存（非源数据），DROP 重建零风险，下次播放自动重下
--
-- 历史 migration 20260802030000_simplify_audio_cache 只删了 .tmp 行没动 DDL，本 migration 补上。

-- 1. 删旧索引（uid / status 在新 schema 里不存在）
DROP INDEX IF EXISTS "AudioCache_uid_idx";
DROP INDEX IF EXISTS "AudioCache_status_idx";

-- 2. 重建表为最终 6 列结构（与 schema.prisma 当前定义一致）
DROP TABLE IF EXISTS "AudioCache";
CREATE TABLE "AudioCache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cacheKey" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "size" INTEGER,
    "contentType" TEXT,
    "lastAccessAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. 重建索引（与 schema.prisma 当前定义一致）
CREATE UNIQUE INDEX "AudioCache_cacheKey_key" ON "AudioCache"("cacheKey");
CREATE INDEX "AudioCache_lastAccessAt_idx" ON "AudioCache"("lastAccessAt");
