# 外部音源异步初始化分析

## 问题描述

外部音源可能会执行如下异步初始化代码：

```javascript
let L = (c) =>
  new Promise((N, S) => {
    w(c, { method: 'GET' }, (y, G, F) => {
      if (y || !G.body.vinfo) {
        return S(Error('FAILED'))
      }
      // 返回版本信息
      N({ s: F.s, m: F.m, lv: G.body.vinfo.lv, lu: G.body.vinfo.lu, lh: G.body.vinfo.lh })
    })
  })

Promise.any([
  L('https://registry.npmjs.org/flower-source-info/latest'),
  L('https://registry.npmmirror.com/flower-source-info/latest')
])
  .then((c) => { j = c })
  .finally(() => {
    // 验证脚本 MD5
    if (!j || (j.m && T.crypto.md5(U.rawScript.trim()) != j.m)) {
      throw Error('服务器异常')
    }
    // 构建音源配置
    let c = {}
    for (let S of j.s.trim().split('&'))
      c[(S = S.split('|')).shift()] = {
        type: 'music',
        actions: ['musicUrl'],
        qualitys: S,
      }
    const N = { sources: c }
    h(O.inited, N)  // 调用初始化事件
  })
```

## 对 executeScript 的影响

### 1. ✅ 已正确处理的问题

#### 1.1 异步等待机制
当前实现已有完善的等待机制：
```javascript
const maxWaitTime = 5000 // 最多等待5秒
const checkInterval = 100 // 每100ms检查一次
let waited = 0

while (!this.isInitialized && waited < maxWaitTime) {
  await new Promise((resolve) => setTimeout(resolve, checkInterval))
  waited += checkInterval
}
```

**优点：**
- 可以等待异步 Promise 完成
- 有超时保护，不会无限等待
- 轮询机制不会阻塞主线程

#### 1.2 错误捕获机制
已注册全局错误处理器：
```javascript
process.on('uncaughtException', errorHandler)
process.on('unhandledRejection', rejectionHandler)
```

**可以捕获：**
- `Promise.any()` 的 rejection（所有请求都失败）
- `.finally()` 中的 `throw Error('服务器异常')`
- MD5 校验失败的错误

#### 1.3 重复初始化保护
```javascript
case 'inited':
  if (self.isInitialized) {
    return reject(new Error('脚本已经初始化'))
  }
```

**效果：**
- 第一次调用 `h(O.inited, N)` 成功
- 第二次调用会被拒绝并记录错误

### 2. ⚠️ 潜在问题

#### 2.1 网络请求超时
如果两个 NPM registry 都响应慢：
- 可能超过 5 秒等待时间
- `executeScript` 会抛出超时错误
- 但此时 Promise 仍在执行

**影响：**
- 超时后如果 Promise 完成，`h(O.inited, N)` 会被调用
- 但由于已经抛出错误，脚本状态不一致

#### 2.2 重复初始化的 rejection
外部代码中有两次 `h(O.inited, N)` 调用：
```javascript
h(O.inited, N)
// ... 更新检查 ...
h(O.inited, N)  // 这次会被 reject
```

**影响：**
- 第二次调用会产生 unhandledRejection
- 会被错误处理器捕获并记录
- 不影响功能，但会有额外的错误日志

#### 2.3 网络请求在脚本上下文中执行
外部代码使用 `w()` 函数（即 `lx.request`）发起请求：
- 请求在 eval() 执行的上下文中
- 请求完成时脚本已经执行完毕
- 回调会在不同的执行阶段触发

### 3. 🔧 建议改进

#### 3.1 增加超时时间
对于需要网络请求的脚本，5秒可能不够：
```javascript
const maxWaitTime = 10000 // 改为 10 秒
```

#### 3.2 忽略重复初始化的错误
在错误处理中区分不同类型的错误：
```javascript
const rejectionHandler = (reason) => {
  if (!this.isInitialized) {
    // 记录错误
  } else if (reason.message === '脚本已经初始化') {
    // 忽略重复初始化的错误（这是预期行为）
    console.log('[Warning] 检测到重复初始化调用（已忽略）')
    return
  }
}
```

#### 3.3 添加初始化状态日志
```javascript
console.log('[Execute] 脚本代码执行完成，等待异步初始化...')
console.log('[Execute] 如果脚本需要网络请求，可能需要更长时间')

// 在等待循环中添加进度提示
if (waited > 0 && waited % 1000 === 0) {
  console.log(`[Wait] 已等待 ${waited/1000} 秒...`)
}
```

## 测试建议

### 测试场景 1: 网络正常
- 两个 registry 都能访问
- 应在 1-2 秒内完成初始化

### 测试场景 2: 网络慢
- 使用代理或限速
- 测试是否会超时

### 测试场景 3: 网络失败
- 两个 registry 都不可访问
- 应捕获到 Promise.any 的 rejection

### 测试场景 4: MD5 校验失败
- 修改脚本内容
- 应捕获到 "服务器异常" 错误

## 总结

**当前实现是安全的**，主要原因：
1. ✅ 有完善的异步等待机制
2. ✅ 有全局错误捕获
3. ✅ 有重复初始化保护
4. ✅ 有超时保护机制

**小的改进建议**：
1. 适当增加超时时间（5秒 → 10秒）
2. 优化重复初始化错误的日志
3. 添加更详细的等待过程提示

外部音源的异步初始化模式是常见的，您的实现已经考虑到了这些情况。
