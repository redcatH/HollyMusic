# 野花音源调试问题解决方案

## 问题分析

### 错误信息
```
[Init Error] Cannot read properties of undefined (reading 'EVENT_NAMES')
[Init Error] 服务器异常
[Error] 脚本执行失败: 服务器异常
```

### 原因分析

这个错误由两个问题导致：

#### 1. 网络请求失败
脚本在初始化时会请求以下 URL 获取版本信息：
```javascript
https://registry.npmjs.org/flower-source-info/latest
https://registry.npmmirror.com/flower-source-info/latest
```

如果这两个请求都失败，`Promise.any()` 会抛出异常，导致：
```javascript
j = { s: 'kw|128k&wy|128k&mg|128k&tx|128k&kg|128k' } // 默认值
```

然后在检查时抛出"服务器异常"错误：
```javascript
if (!j || (j.m && T.crypto.md5(U.rawScript.trim()) != j.m)) {
  throw Error('服务器异常')
}
```

#### 2. 脚本作用域问题
野花脚本使用立即执行函数：
```javascript
;(() => {
  let { EVENT_NAMES: O, request: w, ... } = globalThis.lx
  // ...
})()
```

如果在函数执行时 `globalThis.lx` 未正确初始化，会导致解构赋值失败。

---

## 解决方案

### 方案 1：使用调试版测试脚本（推荐）

运行改进的调试脚本：
```bash
node test-flower-debug.js
```

**优势**：
- 更详细的错误信息
- 更好的错误处理
- 只测试第一个音源（更快）
- 提供问题诊断建议

### 方案 2：设置代理

如果网络需要代理访问：

```javascript
const simulator = new LXEnvironmentSimulator()

// 设置代理
simulator.setProxy('127.0.0.1', '7890')

await simulator.loadScript('./flower-v1-de.js')
```

### 方案 3：修改脚本跳过版本检查

创建一个修改版的脚本，跳过网络请求：

```javascript
/**
 * @name 野花🌷(离线版)
 * @version 1
 */
;(() => {
  let {
      EVENT_NAMES: O,
      request: w,
      on: g,
      send: h,
      env: E,
      version: C,
      currentScriptInfo: U,
      utils: T,
    } = globalThis.lx

  // ... (其他代码保持不变)

  // 跳过网络请求，直接使用默认配置
  const j = { 
    s: 'kw|128k,320k,flac&kg|128k,320k,flac&tx|128k,320k,flac&wy|128k,320k,flac&mg|128k,320k,flac',
    m: null, // 跳过 MD5 校验
    lv: null, // 跳过版本检查
  }

  // 直接初始化
  let sources = {}
  for (let S of j.s.trim().split('&')) {
    const parts = S.split('|')
    const source = parts[0]
    const qualitys = parts[1].split(',')
    
    sources[source] = {
      type: 'music',
      actions: ['musicUrl'],
      qualitys: qualitys,
    }
  }

  h(O.inited, { sources })
})()
```

### 方案 4：等待网络恢复

野花服务器可能暂时不可用。等待一段时间后重试。

### 方案 5：检查网络连接

确保可以访问：
```bash
# 测试 npm registry
curl https://registry.npmjs.org/flower-source-info/latest

# 或使用镜像
curl https://registry.npmmirror.com/flower-source-info/latest
```

---

## 验证修复

### 1. 测试脚本加载
```bash
node test-flower-debug.js
```

应该看到：
```
[Script Info] { name: '野花🌷', version: '1', ... }
[Debug] globalThis.lx 已准备就绪
[Debug] EVENT_NAMES: { request: 'request', inited: 'inited', ... }
[Execute] 开始执行脚本...
```

### 2. 查看初始化日志
```
[Init] 自定义源初始化成功: {
  "sources": {
    "kw": {
      "type": "music",
      "actions": ["musicUrl"],
      "qualitys": ["128k", "320k", "flac"]
    }
    ...
  }
}
```

### 3. 测试获取 URL
```
[HTTP] GET http://97.64.37.235/flower/v1/url/kw/243699/128k
[Result] "https://..."
✅ 成功获取 URL
```

---

## 调试技巧

### 1. 启用断点调试

在 VSCode 中：
1. 打开 `flower-v1-de.js`
2. 在第 6 行设置断点（解构 globalThis.lx 的地方）
3. 按 F5 开始调试
4. 查看 `globalThis.lx` 的值

### 2. 添加日志输出

在脚本开头添加：
```javascript
;(() => {
  console.log('[Debug] globalThis:', globalThis)
  console.log('[Debug] globalThis.lx:', globalThis.lx)
  
  let { EVENT_NAMES: O, ... } = globalThis.lx
  console.log('[Debug] EVENT_NAMES:', O)
  // ...
})()
```

### 3. 检查模拟器初始化

在 `index.js` 的 `executeScript` 方法中已添加调试日志：
```javascript
console.log('[Debug] globalThis.lx 已准备就绪')
console.log('[Debug] EVENT_NAMES:', globalThis.lx.EVENT_NAMES)
```

### 4. 使用 try-catch 包裹脚本

```javascript
;(() => {
  try {
    let { EVENT_NAMES: O, ... } = globalThis.lx
    // ... 原有逻辑
  } catch (error) {
    console.error('[Script Error]', error)
    throw error
  }
})()
```

---

## 常见问题

### Q: 为什么会请求 npm registry？
A: 野花音源使用 npm package 存储版本信息和配置，包括：
- 支持的音源列表
- 支持的音质
- 脚本 MD5 校验值
- 版本更新信息

### Q: 可以完全离线使用吗？
A: 可以，但需要修改脚本跳过版本检查（见方案 3）

### Q: 野花服务器地址是什么？
A: `http://97.64.37.235/flower/v1`

### Q: 如何验证服务器是否可用？
```bash
curl http://97.64.37.235/flower/v1/url/kw/243699/128k
```

---

## 改进建议

### 1. 增加超时重试
```javascript
const L = (c, retries = 3) =>
  new Promise(async (N, S) => {
    for (let i = 0; i < retries; i++) {
      try {
        const result = await fetch(c)
        return N(result)
      } catch (error) {
        if (i === retries - 1) S(error)
      }
    }
  })
```

### 2. 添加降级方案
```javascript
Promise.any([L(V[0]), L(V[1])])
  .catch(() => {
    // 使用默认配置
    return {
      s: 'kw|128k,320k&kg|128k,320k&...',
      m: null,
    }
  })
  .then((c) => {
    j = c
    // ...
  })
```

### 3. 缓存版本信息
将成功获取的版本信息缓存到本地文件，下次直接读取。

---

## 总结

错误的根本原因是**网络请求失败导致初始化中断**。

**推荐的解决步骤**：
1. 使用 `test-flower-debug.js` 查看详细错误
2. 检查网络连接
3. 如需要，设置代理
4. 或使用离线版脚本

现在运行：
```bash
node test-flower-debug.js
```

查看更详细的诊断信息！
