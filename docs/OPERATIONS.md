# 运维与排障

[返回项目首页](../README.md)

## 数据备份

升级前备份 `prisma_data/`、`config/`、`custom-sources/` 与部署目录的 `.env`。备份 SQLite 时先停止服务，或使用 SQLite 一致性备份工具；不要在写入过程中直接复制数据库文件。`cache_data/` 是可重新生成的音频缓存，按需备份。

## 缓存管理

项目有三层缓存：

1. **内存缓存**（`lib/cache-manager.ts`）：搜索结果与播放 URL，默认 TTL 210 分钟（可由 `SEARCH_CACHE_TTL_MS` 调整）。通过 `/api/admin/cache` 清理（需管理员）：

   ```bash
   # 清理搜索缓存
   curl -X POST https://<你的域名>/api/admin/cache \
     -H "Content-Type: application/json" \
     -H "Cookie: holly_user=admin; holly_sig=<你的签名>" \
     -d '{"type":"search"}'

   # 清理全部缓存（搜索 + URL + 音频磁盘）
   curl -X POST https://<你的域名>/api/admin/cache \
     -H "Content-Type: application/json" \
     -H "Cookie: holly_user=admin; holly_sig=<你的签名>" \
     -d '{"type":"all"}'
   ```

   支持 `search` / `url` / `audio` / `all` / `scan-orphans` / `clean-orphans` 类型。若 nginx 强制 HTTP→HTTPS，请直接用 `https://` 或给 curl 加 `-L`。

2. **音频磁盘缓存**（服务端落盘，`ENABLE_FILE_CACHE=true` 时启用）：LRU 自动清理，admin 可通过 `/api/admin/cache` 查询/清理。

3. **歌词边车缓存**：音源精确歌词会以 `.lrc` 保存在某一份已缓存音频的同级目录，翻译歌词为 `.tlyric.lrc`。同一首歌只缓存一份；读取时会遍历该歌曲各音质的缓存记录查找，找到即直接使用。音频缓存被 LRU 清理时，关联边车文件会一同清理。

## 安全与账号

- **音源脚本沙箱**：第三方洛雪音源脚本在独立子进程的 vm 沙箱中执行（对齐 lx-music-desktop 原版脚本环境，无 `require`/`process` 等任何 Node 能力），并以 Node permission 模式加固（默认拒绝 `child_process` 与文件写入；Node 20/22 用 `--experimental-permission`、Node 23+ 用 `--permission`，不支持时自动回退）。脚本崩溃或内存耗尽只影响该子进程，自动重启恢复；连续崩溃触发熔断保护主服务。管理员上传/订阅脚本前的预校验在一次性子进程中进行。环境变量 `SOURCE_RUNNER_MODE=inline` 可回退为仅 vm 沙箱（主进程直连）模式。
- **密码存储**：当前为明文（`User.subsonicSecret`），与 Subsonic 协议的 `md5(secret+s)` 校验兼容。DB 文件务必做好权限控制。
- **初始管理员**：首次启动优先导入 `config/users.json` 中的显式用户；若没有 `admin`，才自动创建带**随机初始密码**的 `admin`（打印在服务端启动日志，仅显示一次）。随机密码不会写入配置文件或镜像层；登录后强制要求修改密码。历史仍使用 `admin/admin` 弱口令的账户会在启动时被重置为随机密码并标记待改密。
- **登录限速**：按客户端 IP 维度，5 分钟内失败 10 次将锁定该 IP 15 分钟。管理员可在后台「登录锁定」Tab 查看锁定列表并手动解锁。
- **强制改密**：首次登录或管理员重置密码后，`mustChangePassword` 标记为 true，前端会拦截到改密页直到完成修改。
- **鉴权**：签名 Cookie（HMAC-SHA256），生产环境必须设置 `AUTH_SECRET`（≥32 位）
- **用户管理保护**：admin 账户不可删除/改用户名，禁止删除当前登录用户，后端 `requireAdmin()` 强校验

## 常见问题

**Q：无法打开数据库（`Error code 14: Unable to open the database file`）？**
A：检查 `.env` 中 `DATABASE_URL` 路径存在且可写；确认无其他进程锁定 SQLite 文件（Docker 与本地勿并发写同一文件）。

**Q：音源加载失败？**
A：检查 `config/music-sources.json` 路径，查看 `lib/music-source-manager.ts` 打印的初始化日志。

**Q：iOS PWA 顶部按钮被状态栏遮挡？**
A：`frontend/index.html` 保留 `viewport-fit=cover`。固定高度标题栏使用 `safe-header`，高度为 `56px + safe-area-inset-top`；不要只在固定 56px 内增加顶部 padding。独立 PWA 的状态栏、键盘和横竖屏切换仍应在实际 iOS 设备上验证。

**Q：播放/暂停/切歌从头播放？**
A：已改为服务端磁盘缓存 + Range 代理方案，seek / 暂停 / 恢复均由服务端响应，不再有此问题。若仍有异常，检查 `.env` 的 `ENABLE_FILE_CACHE` 是否为 `true`，以及服务端日志是否有 `[AudioCache]` 相关错误。

**Q：开发模式下前端 5173 访问 API 报 401/CORS？**
A：Vite dev server 已配置代理 `/api` → `localhost:3000`，确保后端 `pnpm dev` 正在运行；若用 `pnpm dev:web` 单独启动前端，需先启动后端。
