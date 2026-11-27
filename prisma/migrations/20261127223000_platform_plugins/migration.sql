-- CreateTable
CREATE TABLE "PlatformPluginRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "testsJson" TEXT NOT NULL DEFAULT '{}',
    "ownerId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PlatformPluginBinding" (
    "platform" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "revisionId" TEXT,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("platform", "capability")
);

-- CreateTable
CREATE TABLE "PlatformPluginChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestJson" TEXT NOT NULL,
    "changesJson" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPluginRevision_packageId_version_key" ON "PlatformPluginRevision"("packageId", "version");

