# 如何在 flower-v1-de.js 中设置断点调试

## 🎯 快速开始

### 方法 1：使用离线版（推荐）

1. **打开 `flower-v1-offline.js`**
   ```
   d:\work\liuyi\online\linux\new\lxmuisc\lx-music-desktop-master\flower-v1-offline.js
   ```

2. **设置断点**
   - 点击任意代码行号左侧（会出现红点）
   - 推荐位置：
     - 第 35 行：`g(O.request, ...` - request 事件处理器
     - 第 38 行：`if ('musicUrl' != N)` - 检查 action
     - 第 41 行：`return new Promise` - 开始获取 URL
     - 第 42 行：`let K = '/url/'` - 构建请求路径

3. **启动调试**
   - 按 `F5`
   - 选择 "调试野花音源(离线版)"
   - 或者在调试面板点击绿色播放按钮

4. **单步执行**
   - `F10` - 单步跳过（执行当前行，不进入函数）
   - `F11` - 单步进入（进入函数内部）
   - `Shift+F11` - 单步跳出（跳出当前函数）
   - `F5` - 继续执行到下一个断点

---

## 🔍 在原始脚本中调试

虽然 `flower-v1-de.js` 是通过 `eval()` 执行的，但仍然可以调试！

### 步骤：

#### 1. 启动调试器
```bash
# 按 F5，选择 "调试野花音源(离线版)"
```

#### 2. 找到脚本源码

在调试器中，脚本会以特殊名称出现：

```
野花__.js  ← 在这里！
```

**如何找到它**：
- 调试暂停时，查看左侧 "已加载的脚本" 列表
- 或在调试控制台输入：
  ```javascript
  globalThis.lx.currentScriptInfo.name
  // 输出: "野花🌷(离线测试版)"
  ```

#### 3. 在源码中设置断点

由于脚本是动态加载的，有两种方式设置断点：

##### 方式 A：代码中添加 debugger

在 `flower-v1-offline.js` 中添加 `debugger;` 语句：

```javascript
g(O.request, ({ source: c, action: N, info: { musicInfo: S, type: q } }) => {
  debugger; // ← 添加这行，程序会自动暂停
  
  if ('musicUrl' != N) {
    throw Error('failed')
  }
  // ...
})
```

##### 方式 B：在模拟器中添加断点钩子

修改 `index.js` 的 `executeScript` 方法，取消注释这行：

```javascript
debugger; // 取消注释这行可以在脚本执行前自动暂停
eval(scriptContent + `\n//# sourceURL=${sourceURL}`)
```

改为：
```javascript
debugger; // ← 程序会在执行脚本前暂停
eval(scriptContent + `\n//# sourceURL=${sourceURL}`)
```

然后：
1. 按 `F5` 启动调试
2. 程序会在 `debugger;` 处暂停
3. 按 `F11` 单步进入，进入 eval 的脚本内部
4. 现在可以在脚本中设置断点了

---

## 📍 推荐的断点位置

### 1. 请求处理器入口
```javascript
// 第 35 行
g(O.request, ({ source: c, action: N, info: { musicInfo: S, type: q } }) => {
  debugger; // ← 断点：查看传入的参数
  // 查看：source, action, musicInfo, quality
})
```

**可以查看**：
- `source` - 音源名称 (kw/kg/tx/wy/mg)
- `action` - 操作类型 (musicUrl)
- `musicInfo` - 歌曲信息 (songmid, name, singer, etc.)
- `q` - 音质 (128k/320k/flac/flac24bit)

---

### 2. 构建请求路径
```javascript
// 第 42 行
let K = '/url/' + c + '/' + z(c, S) + '/' + q
debugger; // ← 断点：查看请求路径
// 查看 K 的值，例如: "/url/kw/243699/128k"
```

---

### 3. 生成请求标签
```javascript
// 第 43-46 行
P.tag = T.buffer.bufToString(
  T.buffer.from(JSON.stringify(K.match(/(?:\d\w)+/g), null, 1)),
  'hex'
)
debugger; // ← 断点：查看生成的 tag
// 查看 P.tag 和完整的 P 对象
```

---

### 4. HTTP 请求
```javascript
// 第 47 行
w(
  'http://97.64.37.235/flower/v1' + K,
  {
    method: 'GET',
    headers: P,
  },
  (b, D) => {
    debugger; // ← 断点：查看响应
    // 查看：b (错误), D (响应对象)
  }
)
```

---

### 5. 初始化配置
```javascript
// 第 68 行（离线版）
let sources = {}
for (let sourceStr of j.s.trim().split('&')) {
  debugger; // ← 断点：查看每个音源的配置
  const parts = sourceStr.split('|')
  // ...
}
```

---

## 🛠️ 调试技巧

### 1. 查看变量

**鼠标悬停**：
- 将鼠标悬停在变量上
- 会显示变量的当前值

**监视窗口**：
- 在左侧 "监视" 面板添加表达式
- 例如：`source`, `musicInfo.songmid`, `P.tag`

**调试控制台**：
- 在底部打开 "调试控制台"
- 输入变量名或表达式：
  ```javascript
  source
  musicInfo
  P
  JSON.stringify(P, null, 2)
  ```

---

### 2. 条件断点

右键断点 → "编辑断点" → "表达式"：

```javascript
// 只在酷我音源时暂停
source === 'kw'

// 只在 320k 音质时暂停
q === '320k'

// 组合条件
source === 'kw' && q === '320k'
```

---

### 3. 日志点

右键行号 → "添加日志点"：

```javascript
// 输出变量值，但不暂停程序
source={source}, songmid={z(c, S)}, quality={q}
```

---

### 4. 调用堆栈

在左侧 "调用堆栈" 面板：
- 查看函数调用链
- 点击任意函数可以跳转到对应位置
- 可以在不同层级之间切换

示例堆栈：
```
→ (匿名) [flower-v1-offline.js:42]
  Promise (匿名)
  (匿名) [flower-v1-offline.js:41]
  callAPI [index.js:520]
  getMusicUrl [index.js:540]
  main [test-flower-offline.js:55]
```

---

## 🎬 实战演练

### 场景 1：调试音乐 URL 获取流程

1. **在第 35 行设置断点**（请求处理器入口）
2. **按 F5 启动调试**
3. **程序暂停**，查看：
   ```javascript
   source = 'kw'
   action = 'musicUrl'
   musicInfo = { name: '起风了', songmid: '243699', ... }
   q = '128k'
   ```
4. **按 F10 多次**，逐步执行到第 42 行
5. **查看 K 的值**：`"/url/kw/243699/128k"`
6. **继续按 F10**，看到构建请求头
7. **在回调函数内设置断点**（第 54 行）
8. **按 F5 继续**
9. **程序暂停在回调**，查看响应：
   ```javascript
   b = null (无错误)
   D.body = { code: 0, msg: 'success', data: 'https://...' }
   ```

---

### 场景 2：调试请求头生成

1. **在第 43 行设置断点**
2. **启动调试**
3. **查看生成过程**：
   ```javascript
   K = "/url/kw/243699/128k"
   K.match(/(?:\d\w)+/g) = ["243699", "128k"]
   JSON.stringify(...) = '["243699","128k"]'
   Buffer.from(...) = <Buffer ...>
   bufToString(..., 'hex') = "..." (十六进制字符串)
   ```
4. **查看最终的 P 对象**：
   ```javascript
   P = {
     'User-Agent': 'lx-music/desktop',
     ver: '2.0.0',
     'source-ver': '1',
     tag: '2b2232343336393922...'
   }
   ```

---

### 场景 3：调试初始化失败

如果脚本初始化失败：

1. **在 index.js 第 452 行设置断点**（executeScript 的 eval 行）
2. **启动调试**
3. **按 F11 单步进入 eval**
4. **逐步执行脚本**，找出失败位置
5. **查看错误捕获**：
   ```javascript
   initError
   errorDetails
   ```

---

## 📊 查看网络请求

### 在调试控制台：

```javascript
// 查看即将发送的请求
console.log('URL:', 'http://97.64.37.235/flower/v1' + K)
console.log('Headers:', P)

// 在回调中查看响应
console.log('Response:', D)
console.log('Body:', D.body)
```

### 模拟器已自动输出：

```
[HTTP] GET http://97.64.37.235/flower/v1/url/kw/243699/128k
[Result] "https://..."
```

---

## 🚨 常见问题

### Q: 找不到脚本源文件？
A: 
- 脚本名称是 `野花__.js`（中文字符被替换为下划线）
- 在 "已加载的脚本" 列表中查找
- 或者添加 `debugger;` 强制暂停

### Q: 断点不生效？
A: 
- 确保使用 F5 调试而不是直接运行
- 脚本是动态 eval 的，首次执行时可能无法设置断点
- 使用 `debugger;` 语句代替

### Q: 看不到变量值？
A: 
- 确保程序已暂停
- 在 "变量" 面板查看局部变量
- 在 "监视" 面板添加表达式
- 在调试控制台输入变量名

### Q: 如何跳过模拟器代码？
A: 
- 在 launch.json 中已配置 `skipFiles`
- 或在调试时右键函数 → "永不在此处暂停"

---

## 💡 高级技巧

### 1. 修改变量值

在调试控制台：
```javascript
// 修改音质
q = '320k'

// 修改请求路径
K = '/url/kw/99999/flac'

// 修改请求头
P.tag = 'custom_tag'
```

### 2. 热重载

修改脚本后：
- 按 `Ctrl+Shift+F5` 重启调试
- 不需要手动停止再启动

### 3. 多个断点

- 设置多个断点
- 按 `F5` 会依次在每个断点暂停
- 查看不同阶段的变量值

### 4. 性能分析

在调试控制台：
```javascript
console.time('request')
// ... 代码执行 ...
console.timeEnd('request')
// 输出: request: 156.789ms
```

---

## 🎉 现在开始调试！

1. **打开** `flower-v1-offline.js`
2. **设置断点**（点击行号左侧）
3. **按 F5** 启动调试
4. **享受调试**！🐛✨

推荐从第 35 行开始（请求处理器入口），这是整个流程的起点。
