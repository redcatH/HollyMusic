# 原始项目脚本加载机制分析

## 关键发现

**原始项目不使用 `eval()`，而是在独立的 Electron BrowserWindow 中使用 `webFrame.executeJavaScript()` 执行脚本！**

## 原始项目的实现架构

### 1. 独立的沙箱环境

```typescript
// src/main/modules/userApi/main.ts (第 58-100 行)
browserWindow = new BrowserWindow({
  show: false,
  webPreferences: {
    contextIsolation: true,    // 上下文隔离
    nodeIntegration: false,    // 禁用 Node.js
    sandbox: false,
    preload: preloadUrl,       // 关键：preload 脚本
  },
})
```

### 2. 安全的 API 暴露

```javascript
// src/main/modules/userApi/renderer/preload.js (第 204 行开始)
contextBridge.exposeInMainWorld('lx', {
  EVENT_NAMES,
  request(url, { method, timeout, headers, body }, callback) {
    // 使用 needle 库发起请求
    let request = needle.request(method, url, data, options, (err, resp, body) => {
      callback.call(this, err, resp, body)
    }).request
    
    return () => {
      if (!request.aborted) request.abort()
    }
  },
  send(eventName, data) { /* ... */ },
  on(eventName, handler) { /* ... */ },
  // ...
})
```

### 3. 脚本执行方式

```javascript
// src/main/modules/userApi/renderer/preload.js (第 370 行)
webFrame.executeJavaScript(userApi.script).catch(_ => _)
```

**关键点：**
- `webFrame.executeJavaScript()` 在浏览器上下文中异步执行
- 返回 Promise，但**不等待脚本中的异步操作完成**
- 脚本中的 `Promise.any()` 会在后台继续执行

### 4. 错误捕获机制

```javascript
// src/main/modules/userApi/renderer/preload.js (第 354-364 行)
webFrame.executeJavaScript(`(() => {
window.addEventListener('error', (event) => {
  if (event.isTrusted) globalThis.__lx_init_error_handler__.sendError(event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  if (!event.isTrusted) return
  const message = typeof event.reason === 'string' ? event.reason : event.reason?.message
  globalThis.__lx_init_error_handler__.sendError(message)
})
})()`)
```

### 5. 初始化流程

```
Main Process (主进程)
    ↓
创建 BrowserWindow (隔离环境)
    ↓
加载 preload.js (注入 lx API)
    ↓
加载 user-api.html (空白页面)
    ↓
executeJavaScript(script) (执行脚本)
    ↓
脚本发起 Promise.any([...网络请求...])
    ↓                           ↓
脚本继续执行                 网络请求在后台进行
(不等待网络请求)                  ↓
                            请求完成
                                ↓
                            调用 lx.send('inited', data)
                                ↓
                            通过 IPC 发送到主进程
                                ↓
                            主进程更新状态
```

## 你的 Node.js 模拟器的差异

### 当前实现

```javascript
// 使用 eval() 同步执行
eval(scriptContent)

// eval() 立即返回，但脚本中的异步操作仍在后台执行
// 需要轮询等待 this.isInitialized 变为 true

while (!this.isInitialized && waited < maxWaitTime) {
  await new Promise(resolve => setTimeout(resolve, 100))
  waited += 100
}
```

### 为什么打断点能工作

1. **时间延长效应**
   - 单步执行减慢了整体速度
   - 给了后台的网络请求更多完成时间
   - 当执行到等待循环时，Promise.any() 可能已经完成

2. **V8 引擎的微任务调度**
   - 打断点时，事件循环有机会处理微任务队列
   - Promise 的 `.then()` 和 `.finally()` 回调得以执行
   - 没有断点时，同步代码执行太快，微任务队列来不及处理

### 根本原因

**`eval()` 是同步的，`webFrame.executeJavaScript()` 也不等待异步操作，但两者的区别在于：**

1. **执行上下文**
   - `eval()`: 在 Node.js 主线程中执行
   - `webFrame.executeJavaScript()`: 在 Electron 渲染进程的浏览器上下文中执行

2. **事件循环**
   - Node.js 的事件循环和浏览器的事件循环有差异
   - 浏览器环境对异步操作的处理更成熟

3. **执行速度**
   - `eval()` 在 Node.js 中可能执行得非常快
   - 浏览器环境有更多的"喘息"时间来处理异步操作

## 解决方案

### 方案 1：增加超时时间（已实施）

```javascript
const maxWaitTime = 30000 // 30 秒
```

**优点：**
- 简单直接
- 给网络请求足够时间

**缺点：**
- 如果网络真的很慢，还是可能超时
- 如果请求失败，会浪费 30 秒

### 方案 2：更智能的检测（推荐）

追踪活跃的 HTTP 请求数量：

```javascript
let activeRequests = 0

request(url, options, callback) {
  activeRequests++
  console.log(`[HTTP] 活跃请求: ${activeRequests}`)
  
  const request = needle.request(method, url, data, options, (err, resp) => {
    activeRequests--
    console.log(`[HTTP] 请求完成，剩余: ${activeRequests}`)
    callback(err, resp, body)
  }).request
  
  return cancelFunc
}

// 在 executeScript 中
while (!this.isInitialized && waited < maxWaitTime) {
  await new Promise(resolve => setTimeout(resolve, checkInterval))
  waited += checkInterval
  
  // 如果所有请求都完成了，再等待一会儿让 Promise 链完成
  if (activeRequests === 0 && waited > 2000) {
    console.log('[Wait] 所有 HTTP 请求已完成，等待 Promise 链处理...')
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (this.isInitialized) break
  }
  
  // 输出进度
  if (waited % 1000 === 0) {
    console.log(`[Wait] 已等待 ${waited/1000} 秒，活跃请求: ${activeRequests}`)
  }
}
```

### 方案 3：Promise 化（最佳）

提供一个 Promise 版本的 request，但**保持向后兼容**：

```javascript
globalThis.lx = {
  // 原有的回调版本（保持兼容）
  request(url, options, callback) {
    // ... 现有实现
  },
  
  // 新的 Promise 版本
  requestPromise(url, options = {}) {
    return new Promise((resolve, reject) => {
      this.request(url, options, (err, resp, body) => {
        if (err) reject(err)
        else resolve({ resp, body })
      })
    })
  },
}
```

然后外部脚本可以选择使用：
```javascript
// 旧方式（回调）
lx.request(url, options, (err, resp, body) => { /* ... */ })

// 新方式（async/await）
const { resp, body } = await lx.requestPromise(url, options)
```

### 方案 4：模拟 webFrame.executeJavaScript 的行为

使用 `vm` 模块在独立上下文中执行：

```javascript
const vm = require('vm')

async executeScript(scriptContent) {
  // 创建沙箱上下文
  const sandbox = {
    lx: globalThis.lx,
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Promise: Promise,
    // ... 其他必要的全局对象
  }
  
  // 在沙箱中执行
  const context = vm.createContext(sandbox)
  
  try {
    vm.runInContext(scriptContent, context, {
      timeout: 10000, // 10 秒超时（仅限同步部分）
      displayErrors: true,
    })
    
    // 等待异步初始化
    // ... (现有的等待逻辑)
  } catch (error) {
    // ...
  }
}
```

## 测试建议

### 添加详细的请求日志

```javascript
request(url, options, callback) {
  const requestId = Math.random().toString(36).substr(2, 9)
  const startTime = Date.now()
  
  console.log(`[HTTP ${requestId}] 开始: ${method} ${url}`)
  
  const request = needle.request(method, url, data, options, (err, resp) => {
    const elapsed = Date.now() - startTime
    
    if (err) {
      console.log(`[HTTP ${requestId}] 失败: ${err.message} (耗时 ${elapsed}ms)`)
    } else {
      console.log(`[HTTP ${requestId}] 成功: ${resp.statusCode} (耗时 ${elapsed}ms)`)
    }
    
    callback(err, resp, body)
  }).request
  
  return cancelFunc
}
```

### 测试场景

1. **快速网络**（< 2 秒）
2. **慢速网络**（3-5 秒）
3. **超慢网络**（> 10 秒）
4. **网络失败**（所有请求失败）
5. **部分失败**（Promise.any 中一个成功，一个失败）

## 总结

**原始项目的核心设计：**
1. ✅ 独立的 BrowserWindow（安全隔离）
2. ✅ contextBridge（安全的 API 暴露）
3. ✅ webFrame.executeJavaScript（在浏览器上下文中执行）
4. ✅ 事件驱动（通过 IPC 通信）
5. ✅ 不等待脚本中的异步操作（让它们在后台完成）

**你的模拟器的差异：**
1. ❌ 使用 eval() 在 Node.js 中执行
2. ❌ 同步执行，速度太快
3. ✅ 有轮询等待机制（但可能不够长）
4. ✅ 有错误捕获（但机制不同）

**当前最佳实践：**
- 增加超时时间到 30 秒（已实施）
- 添加请求追踪日志
- 考虑实施方案 2（追踪活跃请求）
- 文档化这个行为差异

**重要提示：**
这不是你的代码的 bug，而是 `eval()` 和 `webFrame.executeJavaScript()` 在异步处理上的固有差异。原始项目也需要等待异步操作完成，只是它在不同的环境中执行。
