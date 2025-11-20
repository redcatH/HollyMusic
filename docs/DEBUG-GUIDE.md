# VS Code 调试指南

## 调试 Next.js API 端点

### 方法 1: 使用调试配置启动（推荐）

1. **停止当前运行的服务器**（如果正在运行）
2. 按 `F5` 或点击左侧调试图标，选择 **"Next.js: debug server-side"**
3. 在你的 API 路由文件中设置断点（例如 `app/api/search/route.ts`）
4. 发送 HTTP 请求，调试器会在断点处暂停

### 方法 2: Attach 到运行中的服务器

1. **修改 package.json** 添加调试脚本（可选）：
```json
{
  "scripts": {
    "dev": "next dev",
    "dev:debug": "NODE_OPTIONS='--inspect' next dev"
  }
}
```

2. **Windows PowerShell 启动调试模式**：
```powershell
$env:NODE_OPTIONS='--inspect'; pnpm dev
```

3. 在 VS Code 中选择 **"Next.js: attach"** 配置并启动（F5）

### 设置断点

#### 在 API 路由中：
```typescript
// app/api/search/route.ts
export async function GET(request: NextRequest) {
  debugger; // 或在行号左侧点击设置断点
  
  const searchParams = request.nextUrl.searchParams
  const source = searchParams.get('source')
  // ...
}
```

#### 在 music-core 模块中：
```javascript
// lib/music-core/music-search.js
async search(songName, page, limit) {
  debugger; // JavaScript 也支持断点
  
  const url = `https://...`
  // ...
}
```

### 调试技巧

1. **查看变量**：鼠标悬停在变量上或在左侧"变量"面板查看
2. **调用堆栈**：查看函数调用链，了解代码执行路径
3. **监视表达式**：右键点击变量 → "添加到监视"
4. **条件断点**：右键断点 → "编辑断点" → 添加条件
5. **日志点**：不停止执行，只输出日志到调试控制台

### 调试快捷键

- `F5` - 开始调试 / 继续
- `F9` - 切换断点
- `F10` - 单步跳过
- `F11` - 单步进入
- `Shift+F11` - 单步跳出
- `Shift+F5` - 停止调试

### 调试示例

#### 调试搜索 API：
1. 在 `app/api/search/route.ts` 第 15 行设置断点
2. 按 `F5` 启动调试
3. 在浏览器或 REST Client 中访问：
   ```
   GET http://localhost:3000/api/search?source=kw&keyword=周杰伦&page=1&limit=30
   ```
4. VS Code 会自动暂停在断点处

#### 调试 URL 获取：
1. 在 `lib/music-source-manager.ts` 的 `getMusicUrl` 方法中设置断点
2. 发送 POST 请求到 `/api/music-url`
3. 检查 `musicInfo` 参数和返回值

### 常见问题

**Q: 断点显示灰色，提示"未绑定断点"？**
A: 确保文件已保存，并且服务器已完全启动。可能需要重启调试会话。

**Q: 无法在 .js 文件中调试？**
A: Next.js 默认支持。确保文件在 `serverExternalPackages` 中（已配置）。

**Q: Source maps 不准确？**
A: 检查 `next.config.ts` 中是否启用了 source maps（开发模式默认启用）。

### 调试控制台输出

所有 `console.log`、`logger.debug` 等输出会显示在：
- **调试控制台** - VS Code 底部面板
- **终端** - 如果使用 node-terminal 类型
