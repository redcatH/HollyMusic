CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "valueJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- 在迁移时保存判断结果，而非根据迁移后必然存在的数据库文件/表判断首装。
-- 已有管理员无需再次设置；历史数据缺少管理员时关闭匿名初始化入口。
INSERT INTO "SystemSetting" ("key", "valueJson", "updatedAt")
SELECT 'system.initialization',
    CASE
        WHEN EXISTS (SELECT 1 FROM "User" WHERE "username" = 'admin')
            THEN '{"version":1,"status":"completed","source":"legacy","completedAt":"' || strftime('%Y-%m-%dT%H:%M:%fZ', 'now') || '"}'
        WHEN EXISTS (SELECT 1 FROM "User")
          OR EXISTS (SELECT 1 FROM "MusicInfo")
          OR EXISTS (SELECT 1 FROM "Favorite")
          OR EXISTS (SELECT 1 FROM "Playlist")
          OR EXISTS (SELECT 1 FROM "PlaylistEntry")
          OR EXISTS (SELECT 1 FROM "PlaylistAllowedUser")
          OR EXISTS (SELECT 1 FROM "PlayHistory")
          OR EXISTS (SELECT 1 FROM "AudioCache")
          OR EXISTS (SELECT 1 FROM "RecommendTask")
            THEN '{"version":1,"status":"recovery","source":"legacy","completedAt":null}'
        ELSE '{"version":1,"status":"pending","source":"new","completedAt":null}'
    END,
    CURRENT_TIMESTAMP;
