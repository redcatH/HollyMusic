-- AlterTable
-- 新增 mustChangePassword：首次登录或使用随机初始密码时置 true，自助改密/管理员重置后清回 false。
-- 不影响 Subsonic 协议鉴权（仅 Web 登录流程使用）。
-- SQLite 不支持直接 ADD COLUMN with default + NOT NULL on existing table in all cases，
-- 但 Prisma 对 SQLite 用 "重建表" 策略；这里用 ADD COLUMN（SQLite ≥ 3.35 支持 NOT NULL DEFAULT）。
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
