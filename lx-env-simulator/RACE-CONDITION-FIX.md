# 竞态条件问题修复说明

## 问题描述

**症状：**
- 在 `request` 函数打断点，单步执行 → ✅ 脚本正常加载
- 不打断点，直接运行 → ❌ 脚本无法加载，超时错误

## 根本原因

这是一个典型的**竞态条件（Race Condition）**问题：

### 1. 回调模式的异步延迟

`lx.request` 函数使用**回调模式**而非 Promise：

```javascript
request(url, options = {}, callback) {
  const request = needle.request(method, url, data, requestOptions, 
    (err, resp) => {
      // 这个回调会在网络请求完成后才执行
      callback(null, response, bodyData)
    }
  ).request
  
  return cancelFunction  // 立即返回，不等待请求完成
}
```

### 2. 外部脚本的异步流程

外部脚本的执行流程：

```javascript
// 1. 发起网络请求（非阻塞）
Promise.any([
  L('https://registry.npmjs.org/...'),   // 开始请求
  L('https://registry.npmmirror.com/...') // 开始请求
])
  .then((c) => { j = c })
  .finally(() => {
    // 3. 网络请求完成后才执行这里
    h(O.inited, N)  // 调用初始化
  })

// 2. 立即返回，不等待网络请求
```

### 3. 执行时序分析

**正常运行（无断点）：**
```
0ms:   eval() 开始执行脚本
1ms:   脚本发起 Promise.any([L(), L()])
2ms:   lx.request() 调用，开始网络请求
3ms:   lx.request() 立即返回（回调尚未执行）
4ms:   eval() 同步代码执行完成
5ms:   开始等待 this.isInitialized
1000ms: 之前的延迟代码等待 1 秒
1100ms: 检查 isInitialized → false（网络请求可能还在进行）
...
2000ms: 网络请求完成，回调执行
2001ms: Promise.any().finally() 执行
2002ms: h(O.inited, N) 调用，设置 isInitialized = true
2100ms: 下次检查发现 isInitialized = true ✅
```

**问题场景：如果网络请求超过 10 秒**
```
0-4ms:   同上
10000ms: 等待超时，抛出错误 ❌
12000ms: 网络请求才完成（但已经超时）
```

**打断点（调试模式）：**
```
0ms:   eval() 开始执行
1ms:   脚本发起网络请求
2ms:   断点暂停，用户单步执行
...
3000ms: 用户慢慢单步执行（期间网络请求已完成）
3500ms: 网络回调已执行，Promise 已 resolve
4000ms: 继续执行，检查 isInitialized → true ✅
```

## 解决方案

### 方案 1：增加超时时间（已实施）✅

```javascript
// 从 10 秒增加到 15 秒
const maxWaitTime = 15000

// 移除固定的 1 秒延迟
// await new Promise(resolve => setTimeout(resolve, 1000)) // 删除
```

**优点：**
- 简单直接
- 给网络请求更多时间

**缺点：**
- 如果网络特别慢，仍可能超时
- 浪费时间（如果请求很快完成，也要等很久）

### 方案 2：更智能的等待机制（推荐）

检测请求活动状态：

```javascript
// 记录活跃的请求数
let activeRequests = 0

request(url, options, callback) {
  activeRequests++
  console.log(`[HTTP] 开始请求，当前活跃: ${activeRequests}`)
  
  needle.request(method, url, data, requestOptions, (err, resp) => {
    activeRequests--
    console.log(`[HTTP] 请求完成，剩余活跃: ${activeRequests}`)
    callback(err, resp, body)
  })
}

// 在 executeScript 中等待所有请求完成
while (!this.isInitialized && waited < maxWaitTime) {
  await new Promise(resolve => setTimeout(resolve, checkInterval))
  waited += checkInterval
  
  // 如果没有活跃请求了，再多等几秒确保 Promise 链完成
  if (activeRequests === 0 && waited > 2000) {
    console.log('[Wait] 所有请求已完成，等待 Promise 链...')
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (this.isInitialized) break
  }
}
```

### 方案 3：Promise 化 lx.request（最佳）

提供一个 Promise 版本的 request：

```javascript
// 添加到 globalThis.lx
requestPromise(url, options = {}) {
  return new Promise((resolve, reject) => {
    this.request(url, options, (err, resp, body) => {
      if (err) reject(err)
      else resolve({ resp, body })
    })
  })
}
```

然后外部脚本可以：
```javascript
// 使用 async/await
const result = await lx.requestPromise(url, options)
```

## 当前实施的改进

1. ✅ 移除了固定的 1 秒延迟（不必要的等待）
2. ✅ 增加超时时间到 15 秒
3. ✅ 优化了日志提示，说明网络请求需要时间
4. ✅ 保留了重复初始化的保护机制

## 测试建议

### 测试 1：快速网络
```bash
# 应该在 2-3 秒内完成
node test-kw-play.js
```

### 测试 2：慢速网络
```bash
# 设置代理或限速，应该在 15 秒内完成
node test-kw-play.js
```

### 测试 3：无网络
```bash
# 断开网络，应该在 15 秒后超时并报错
node test-kw-play.js
```

## 调试技巧

### 查看请求时序
在 `request` 函数中添加详细日志：

```javascript
request(url, options = {}, callback) {
  const startTime = Date.now()
  console.log(`[HTTP ${startTime}] 开始: ${url}`)
  
  needle.request(method, url, data, requestOptions, (err, resp) => {
    const elapsed = Date.now() - startTime
    console.log(`[HTTP ${startTime}] 完成: ${url} (耗时 ${elapsed}ms)`)
    callback(err, resp, body)
  })
}
```

### 查看初始化时序
```javascript
send(eventName, data) {
  if (eventName === 'inited') {
    const timestamp = Date.now()
    console.log(`[Init ${timestamp}] 收到初始化事件`)
    // ...
  }
}
```

## 总结

**问题本质：**
- `lx.request` 是回调模式，不会阻塞
- 外部脚本的 `Promise.any()` 需要等待网络请求
- 之前的 1 秒延迟太短，10 秒超时在某些情况下也不够

**解决方案：**
- 移除不必要的固定延迟
- 增加超时时间到 15 秒
- 保持轮询检查机制

**为什么打断点能工作：**
- 单步执行减慢了整体速度
- 给了网络请求足够的时间完成
- 当执行到等待循环时，Promise 已经 resolve
