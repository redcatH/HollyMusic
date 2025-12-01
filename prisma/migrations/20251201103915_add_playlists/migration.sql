-- CreateTable
CREATE TABLE "Playlist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "comment" TEXT,
    "public" BOOLEAN NOT NULL DEFAULT false,
    "songCount" INTEGER NOT NULL DEFAULT 0,
    "duration" INTEGER,
    "created" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed" DATETIME NOT NULL,
    "owner" TEXT,
    "coverArt" TEXT,
    CONSTRAINT "Playlist_username_fkey" FOREIGN KEY ("username") REFERENCES "User" ("username") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaylistEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "playlistId" INTEGER NOT NULL,
    "musicInfoId" INTEGER,
    "songmid" TEXT,
    "position" INTEGER NOT NULL,
    "addedBy" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotJson" TEXT,
    "playCount" INTEGER NOT NULL DEFAULT 0,
    "lastPlayed" DATETIME,
    CONSTRAINT "PlaylistEntry_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistEntry_musicInfoId_fkey" FOREIGN KEY ("musicInfoId") REFERENCES "MusicInfo" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaylistAllowedUser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "playlistId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    CONSTRAINT "PlaylistAllowedUser_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistAllowedUser_username_fkey" FOREIGN KEY ("username") REFERENCES "User" ("username") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlayHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "playlistId" INTEGER,
    "entryId" INTEGER,
    "musicInfoId" INTEGER,
    "songmid" TEXT,
    "username" TEXT,
    "playedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientIp" TEXT,
    "userAgent" TEXT
);

-- CreateIndex
CREATE INDEX "Playlist_username_idx" ON "Playlist"("username");

-- CreateIndex
CREATE INDEX "Playlist_public_idx" ON "Playlist"("public");

-- CreateIndex
CREATE INDEX "PlaylistEntry_playlistId_idx" ON "PlaylistEntry"("playlistId");

-- CreateIndex
CREATE INDEX "PlaylistEntry_musicInfoId_idx" ON "PlaylistEntry"("musicInfoId");

-- CreateIndex
CREATE INDEX "PlaylistEntry_songmid_idx" ON "PlaylistEntry"("songmid");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistEntry_playlistId_position_key" ON "PlaylistEntry"("playlistId", "position");

-- CreateIndex
CREATE INDEX "PlaylistAllowedUser_username_idx" ON "PlaylistAllowedUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistAllowedUser_playlistId_username_key" ON "PlaylistAllowedUser"("playlistId", "username");

-- CreateIndex
CREATE INDEX "PlayHistory_playedAt_idx" ON "PlayHistory"("playedAt");

-- CreateIndex
CREATE INDEX "PlayHistory_username_idx" ON "PlayHistory"("username");

-- CreateIndex
CREATE INDEX "PlayHistory_playlistId_idx" ON "PlayHistory"("playlistId");
