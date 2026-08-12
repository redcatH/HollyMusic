# 音源配置热重载功能

## 概述

`MusicSourceManager` 支持对 `config/music-sources.json` 的**懒重载**：每次请求（搜索 / 播放 / 歌词 / 封面）前会计算配置文件的 MD5，与上次加载时记录的哈希比对，若发生变化则自动重新加载音源配置，无需手动重启应用。

## 工作原理

### MD5 懒重载（核心机制）

1. **初始化时记录哈希**：`initialize()` 读取配置文件时，用 `getFileHash()` 计算文件内容的 MD5，存入 `configHash`。
2. **每次请求前检测**：`checkConfigChanged()` 重新计算当前文件 MD5，与 `configHash` 比对：
   - 相同 → 直接使用现有实例（零开销）
   - 不同 → 更新 `configHash`，返回 `true`，触发重载
3. **懒触发**：重载发生在**下一次请求**时，而非文件变更的瞬间。没有 `fs.watch` 文件监听，也没有防抖——每次请求只做一次 MD5 计算，成本可忽略。

### 重载流程

1. 重置实例列表（`resetInstances()`：清空 `instances`，`initialized = false`）
2. 重新读取配置文件
3. 按优先级排序后重新初始化各音源
4. 更新 `initialized` 标志

### 管理端主动重建

管理端 CRUD（增删改音源配置）后调用 `reload()` 强制重建所有实例，**无需等待下次请求触发 MD5 懒重载**，改动立即生效。

## API

### 自动重载（推荐）

```typescript
import { musicSourceManager } from '@/lib/music-source-manager'

// 初始化时记录配置哈希
await musicSourceManager.initialize()

// 之后，修改 config/music-sources.json 会在下一次请求时自动重新加载
```

### 手动重载（管理端 CRUD 后立即生效）

```typescript
// 强制重建所有音源实例
await musicSourceManager.reload()
```

### 初始化并发保护

`initialize()` 使用 `initPromise` 复用同一个初始化 Promise，多次并发调用不会重复加载脚本。

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

保存文件后，**下一次请求**（搜索 / 播放 / 歌词 / 封面）时：
1. 检测到配置 MD5 变更
2. 销毁旧的音源实例
3. 重新加载配置
4. 按新优先级初始化音源

日志输出示例：
```
[info] 检测到配置文件变更，将重新加载
[info] 开始初始化音源管理器...
[info] 重新加载配置文件，找到 3 个音源
[info] 已启用 3 个音源
[info] 音源初始化成功: xiaogou.js [123ms] 支持: ...
```

## 注意事项

1. **懒重载**：配置变更不会立即生效，需等下一次请求触发。若需立即生效（如管理端 CRUD），调用 `reload()`。
2. **MD5 计算**：每次请求都会 `readFileSync` 读取配置文件并计算 MD5，文件很小，开销可忽略。
3. **错误处理**：配置文件读取失败时记录警告日志并返回 `false`（不触发重载），旧实例仍然可用。
4. **初始化并发保护**：`initialize()` 复用 `initPromise`，避免并发调用重复加载。

## 日志级别

- `[info]`：检测到配置变更、初始化事件
- `[debug]`：初始化细节
- `[warn]`：配置文件读取失败等警告
- `[error]`：初始化失败等错误

## 相关配置字段

配置 priority 时记住：**数字越小，优先级越高**

```json
{
  "priority": 1,  // 最高优先级，最先尝试
  "priority": 5,  // 中等优先级
  "priority": 10  // 最低优先级，最后尝试
}
```