# 播放流程改进总结

## 问题与解决方案

### 1. 跨域问题 ✅
**问题**：音乐 URL 来自第三方 API，直接加载会面临跨域限制
**解决**：
- 修改 `useMusicUrl.ts` 在返回 URL 时包装为 proxy 代理 URL
- 原始 URL 作为 GET 参数传给 `/api/proxy?url=xxx`
- 后端代理添加必要的 CORS 头，流式转发响应

```typescript
// useMusicUrl.ts
if (data.success && data.data?.url) {
  // 将获得的 URL 通过 proxy 代理，作为 GET 参数传输
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(data.data.url)}`
  return proxyUrl
}
```

### 2. 播放状态同步问题 ✅
**问题**：Zustand store 中的 `isPlaying` 与 Howler 实例中的播放状态不同步
**解决**：
- 添加反向同步：当音频播放结束时，自动更新 store 中的 `isPlaying`
- 防止状态不一致导致的播放/暂停按钮显示错误

```typescript
// BottomPlayer.tsx
// 当 audio.isPlaying 变化时，同步回 Zustand store（例如播放结束）
useEffect(() => {
  if (audio.isPlaying !== isPlaying && currentMusic) {
    setIsPlaying(audio.isPlaying)
  }
}, [audio.isPlaying, isPlaying, setIsPlaying, currentMusic])
```

### 3. 自动播放下一首 ✅
**问题**：当前歌曲播放完毕后，没有自动播放下一首
**解决**：
- 监听音频播放状态变化
- 当音频停止且不是用户暂停时，自动切换到下一首歌曲

```typescript
// 当音频播放结束时，自动播放下一首
useEffect(() => {
  if (audio.isPlaying === false && currentMusic && currentIndex >= 0 && currentIndex < playlist.length - 1) {
    const nextSong = playlist[currentIndex + 1]
    usePlayerStore.setState({ currentMusic: nextSong })
  }
}, [audio.isPlaying, currentMusic, currentIndex, playlist])
```

### 4. 加载状态管理 ✅
**问题**：加载新 URL 时，需要正确传递 autoplay 状态
**解决**：
- `BottomPlayer` 加载新歌曲时传递 `isPlaying` 状态给 `audio.load()`
- 确保切换歌曲时保持播放状态

```typescript
// 加载时考虑当前播放状态
useEffect(() => {
  if (currentMusic?.originUrl) {
    audio.load(currentMusic.originUrl, isPlaying)
  }
}, [currentMusic?.id, currentMusic?.source, currentMusic?.originUrl, audio, isPlaying])
```

## 数据流图

```
点击播放歌曲
    ↓
app/page.tsx 调用 getMusicUrl(song, '128k')
    ↓
useMusicUrl.ts POST /api/music-url
    ↓
获得原始 URL（第三方音乐服务）
    ↓
包装为代理 URL：/api/proxy?url=xxx（编码后）
    ↓
返回代理 URL 给 BottomPlayer
    ↓
BottomPlayer 加载代理 URL：audio.load(proxyUrl)
    ↓
useAudio 通过 Howler 加载音频
    ↓
/api/proxy 接收请求，转发到原始 URL
    ↓
原始音乐服务返回音频流 ← proxy 添加 CORS 头
    ↓
浏览器接收（跨域问题已解决）
    ↓
Howler 播放音频
    ↓
状态同步到 Zustand store + BottomPlayer
    ↓
播放结束 → 自动播放下一首
```

## 改动文件列表

1. **`hooks/useMusicUrl.ts`**
   - 返回值改为 proxy 代理 URL

2. **`components/layout/BottomPlayer.tsx`**
   - 添加反向状态同步逻辑
   - 添加自动播放下一首逻辑
   - 优化加载状态依赖项

## 测试建议

- [ ] 搜索歌曲并点击播放
- [ ] 验证音乐正常播放（检查网络请求中 `/api/proxy`）
- [ ] 播放列表中改变歌曲，验证之前的歌曲是否停止
- [ ] 播放到末尾，验证是否自动播放下一首
- [ ] 手动暂停后切换歌曲，验证新歌曲是否自动播放

## 注意事项

- ⚠️ Proxy URL 使用 `encodeURIComponent()` 编码，确保特殊字符正确传递
- ⚠️ `/api/proxy` 已添加 CORS 响应头，支持跨域请求
- ⚠️ 音频流式传输，减少初始加载时间
