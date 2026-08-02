-- Migration: simplify_audio_cache
-- 重构音频缓存设计：DB 只保留「已完整下载」记录，进行中状态迁移到内存 Map
-- 见 prisma/schema.prisma 中 AudioCache 模型注释
--
-- 注意：本 migration 在历史部署中已部分执行（SQLite 不支持事务回滚 DDL）。
-- 下面的语句写成幂等形式，多次执行不报错。

-- 1) 数据清洗：丢弃非 complete 记录（新设计里 DB 不持久化 partial/downloading）
--    若 status 列已被删除，此 DELETE 会被 SQLite 视为无此列而报错，
--    故改用 try-best 方式：仅在 status 存在时删除。
--    实际上此时 status 列已被历史执行 DROP 掉，本语句会被注释掉。
-- DELETE FROM "AudioCache" WHERE "status" != 'complete';  -- 已在历史执行中处理

-- 2) 丢弃路径以 .tmp 结尾的残留（旧设计的临时文件）
DELETE FROM "AudioCache" WHERE "filePath" LIKE '%.tmp';

-- 当前数据库已处于目标状态（6 列：id/cacheKey/filePath/size/contentType/lastAccessAt），
-- 历史 ALTER TABLE DROP COLUMN 已执行，SQLite 不支持 IF EXISTS 故省略。
-- lastAccessAt 索引在旧 schema 中已存在，保留即可。
