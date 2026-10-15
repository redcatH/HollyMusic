# 网页播放器状态保存

播放器恢复到暂停状态；点击继续后加载音频，并在元数据就绪时恢复播放位置。恢复本身不新增播放历史，分享链接指定的歌曲优先于旧记录。

## 分层

- `lib/browser-storage.ts`：带版本的 JSON 读写、业务校验入口、存储不可用时的降级。
- `lib/player-storage.ts`：播放器的数据白名单、字段校验和旧音质设置迁移。
- `lib/player-persistence.ts`：账号会话、保存时机和跨标签页偏好同步。
- `hooks/usePlayerPersistence.ts`：登录确认后启动会话，账号变化时先保存并停止旧会话，再恢复新账号。
- `player-store`、`PlayerBar`、`useAudioPlayer`：恢复歌曲、用户播放意图、音频加载和跳转。

## 存储范围

| 键 | 位置 | 内容 |
| --- | --- | --- |
| `holly-player-preferences` | localStorage | 音量、静音、播放模式、音质；设备级偏好，跨标签页同步 |
| `holly-player-session:<账号>` | localStorage + sessionStorage | 主队列、插播队列、当前曲目、主队列游标、插播标志、进度 |
| `holly-player-tab:<账号>` | sessionStorage | 睡眠定时器截止时间、歌词和队列面板展开状态 |

同一标签页刷新优先读取自己的 sessionStorage 副本；没有副本时读取本地账号记录。歌曲和队列不监听其他标签页的实时更新。空闲标签页关闭时不会把旧位置重新写成最新记录。

偏好即时保存。队列变更、暂停和拖动进度时立即保存会话；播放中的普通进度更新最多每 5 秒保存一次，页面隐藏、pagehide 和会话结束时补存。浏览器被强制终止时，可能丢失最后一个保存周期内的进度。

定时器只保存截止时间，刷新后用剩余时间重新注册；已过期的记录失效。浏览器对后台计时器的节流仍可能造成触发延迟，页面可见性变化时会再次检查截止时间。

所有记录使用 `{ version: 1, data: ... }`。未知版本、损坏记录和存储异常均安全回退。旧的 `player:quality` 在新记录成功写入后迁移删除。不会保存播放中标志、加载错误、缓冲进度、音频对象、播放地址或音源临时直链。

搜索页把已提交的关键词和音源写入 `q`、`source` 查询参数，刷新时重新获取结果。主题保持原有存储机制；收藏、歌单、历史、登录继续由服务端管理。

## 扩展与验证

新增偏好时，同时更新偏好类型、默认值、校验器和 store 保存字段。新增播放会话字段时，同时更新快照类型、校验器、恢复动作及保存条件；不要持久化整个 store。改变存储结构需要显式增加版本并提供迁移策略。

回归测试位于 `frontend/hooks/player-persistence.test.ts`、`frontend/hooks/usePlayerPersistence.test.tsx`、`frontend/components/PlayerBar.test.tsx` 和 `frontend/components/SearchPage.test.tsx`，覆盖存储故障、旧设置迁移、账号隔离、刷新恢复、插播顺序、定时器及 URL 导航。
