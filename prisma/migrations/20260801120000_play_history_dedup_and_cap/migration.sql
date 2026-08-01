-- Migration: 为 PlayHistory 增加唯一约束 (username, songmid) 以支持 upsert 去重
--
-- 背景：
--   历史记录原设计每次播放都 INSERT，导致同一首歌出现多行，历史列表重复
--   且 SongRow 的 isCurrent 判断（按 uid 匹配）会让多行同时高亮。
--
-- 改动：
--   1. 删除存量重复行：每组 (username, songmid) 只保留 playedAt 最新的一条
--   2. 创建唯一索引 (username, songmid)，从此 upsert 即可"移动到顶部"
--
-- 线上执行说明：
--   - username / songmid 均可为 NULL，SQLite 中 NULL != NULL，不会被唯一约束拦截
--   - 执行前建议备份：.backup prisma/data/music.db.bak
--   - 该 migration 由 prisma migrate deploy 执行，会自动记录到 _prisma_migrations 表

-- 1. 删除重复行：每组 (username, songmid) 只保留 playedAt 最新的一条
--    用 row_number() 窗口函数（SQLite 3.25+ 支持）定位每组要保留的 id
DELETE FROM "PlayHistory"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id",
           ROW_NUMBER() OVER (
             PARTITION BY "username", "songmid"
             ORDER BY "playedAt" DESC, "id" DESC
           ) AS "rn"
    FROM "PlayHistory"
    WHERE "username" IS NOT NULL
      AND "songmid" IS NOT NULL
  )
  WHERE "rn" > 1
);

-- 2. 创建唯一索引
CREATE UNIQUE INDEX "PlayHistory_username_songmid_key" ON "PlayHistory"("username", "songmid");
