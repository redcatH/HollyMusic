# 音源配置热重载功能

## 概述

`MusicSourceManager` 现已支持对 `config/music-sources.json` 文件的监听和热重载。当配置文件发生变更时，系统会自动检测并重新加载音源配置，无需手动重启应用。

## 工作原理

### 文件监听

1. **初始化时启动监听**：在 `initialize()` 完成后，自动启动 `fs.watch()` 监听配置文件
2. **变更检测**：监听 `change` 事件
3. **防抖处理**：使用 300ms 防抖，避免频繁变更触发多次重载

### 变更指纹

- 每次加载配置时，记录文件的 mtime 和 size 作为"指纹"
- 监听到文件变更事件后，再次计算指纹，只有指纹不同时才执行重载
- 这避免了编辑器的临时写入或其他短暂变更引起的误触发

### 重载流程

1. 停止旧实例（调用 simulator 的 `destroy()` 方法，如果存在）
2. 清空实例列表
3. 重新读取配置文件
4. 按优先级排序后重新初始化各音源
5. 更新 `initialized` 标志

## API

### 自动重载（推荐）

```typescript
import { musicSourceManager } from '@/lib/music-source-manager'

// 初始化时自动启动文件监听
await musicSourceManager.initialize()

// 之后，修改 config/music-sources.json 会自动重新加载
```

### 手动重载

```typescript
// 手动触发重新加载
await musicSourceManager.reload()
```

### 检查是否在重新加载中

```typescript
// 内部有 isReloading 标志防止并发重载
// 如果已有重载在进行，调用 reload() 会返回警告日志
```

### 清理资源

```typescript
// 停止监听并清理所有实例（应用关闭时调用）
musicSourceManager.destroy()
```

## 配置变更示例

修改 `config/music-sources.json`：

```json
{
  "sources": [
    {
      "path": "custom-sources/xiaogou.js",
      "enabled": true,
      "priority": 2,  // 原为 5，改为 2
      "timeout": 15000,
      "name": "xiaogou.js",
      "description": "Huibq keep-alive Music_Free"
    }
  ]
}
```

保存文件后，系统会在 300ms 内自动：
1. 检测到配置变更
2. 销毁旧的音源实例
3. 重新加载配置
4. 按新优先级初始化音源

日志输出示例：
```
[info] 检测到配置文件变更，准备重新加载...
[info] 配置文件已变更，开始重新加载...
[info] 销毁 3 个音源实例
[info] 开始重新加载音源配置...
[info] 重新加载配置文件，找到 3 个音源
[info] 已启用 3 个音源
[info] 音源初始化成功: xiaogou.js [123ms] 支持: ...
...
[info] 音源配置重新加载完成
```

## 注意事项

1. **防抖延迟**：文件变更后需要 300ms 才会触发重载，这是为了避免编辑器多次写入导致的频繁重载
2. **并发保护**：若重载正在进行中，新的重载请求会被忽略，防止并发问题
3. **错误处理**：重载失败时会记录错误日志，但不会中断应用，旧实例仍然可用
4. **simulator 销毁**：如果自定义的 simulator 实例有 `destroy()` 方法，会在重载前调用
5. **生产环境**：建议在应用启动时调用 `destroy()` 完全清理，或使用进程管理工具监控应用状态

## 日志级别

- `[info]`：重要的初始化和重载事件
- `[debug]`：文件监听、变更检测、实例初始化的详细步骤
- `[warn]`：并发重载请求等警告
- `[error]`：初始化失败、监听启动失败等错误

## 相关配置字段

配置 priority 时记住：**数字越小，优先级越高**

```json
{
  "priority": 1,  // 最高优先级，最先尝试
  "priority": 5,  // 中等优先级
  "priority": 10  // 最低优先级，最后尝试
}
```
