-- AlterTable
-- 新增 sessionVersion：会话纪元，参与会话 cookie 签名（HMAC(username:sessionVersion)）。
-- 改密码/管理员重置密码时 +1，使该用户所有旧会话 cookie 立即失效；
-- 升级前签发的旧格式 cookie（无 holly_sv）按 version=0 兼容，部署后不强制全员重新登录。
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
