# 自定义源脚本调试指南

## 方法 1：VSCode 调试器（推荐）⭐

### 使用步骤：

1. **打开 VSCode 的调试面板**
   - 按 `F5` 或点击左侧的调试图标

2. **选择调试配置**
   - 选择 "调试野花音源" 

3. **开始调试**
   - 点击绿色的开始按钮，或按 `F5`

4. **设置断点**
   - 在 `flower-v1.js` 或任何文件中点击行号左侧设置断点
   - 红点表示断点已设置

### 调试功能：

- ✅ **断点调试** - 点击行号左侧设置断点
- ✅ **单步执行** - F10（跳过）/ F11（进入）
- ✅ **查看变量** - 鼠标悬停或查看左侧变量面板
- ✅ **调用堆栈** - 查看函数调用链
- ✅ **监视表达式** - 添加要监视的变量或表达式
- ✅ **断点条件** - 右键断点设置条件

---

## 方法 2：在脚本中添加 debugger 语句

在 `flower-v1.js` 中想要暂停的位置添加 `debugger;`：

```javascript
g(O.request, ({ source: c, action: N, info: { musicInfo: S, type: q } }) => {
  debugger; // ← 程序会在这里暂停
  
  if ('musicUrl' != N) {
    throw Error('fialed')
  }
  
  return new Promise((G, F) => {
    debugger; // ← 或在这里暂停
    
    let K = '/url/' + c + '/' + z(c, S) + '/' + q
    // ...
  })
})
```

然后运行：
```bash
node inspect test-flower.js
```

或在 VSCode 中按 F5 调试，会自动在 `debugger;` 处暂停。

---

## 方法 3：使用 Chrome DevTools

### 步骤：

1. **启动调试服务器**
```bash
cd lx-env-simulator
node --inspect-brk test-flower.js
```

2. **打开 Chrome 浏览器**
   - 访问：`chrome://inspect`
   - 点击 "Open dedicated DevTools for Node"

3. **在 DevTools 中调试**
   - 可以看到所有源文件
   - 设置断点
   - 单步执行
   - 查看变量

### Chrome DevTools 优势：
- 🎯 强大的源码映射
- 📊 性能分析
- 🔍 网络请求查看
- 💾 内存快照

---

## 方法 4：添加日志输出

在 `flower-v1.js` 中添加 `console.log`：

```javascript
g(O.request, ({ source: c, action: N, info: { musicInfo: S, type: q } }) => {
  console.log('🔍 [调试] source:', c)
  console.log('🔍 [调试] action:', N)
  console.log('🔍 [调试] musicInfo:', S)
  console.log('🔍 [调试] quality:', q)
  
  if ('musicUrl' != N) {
    throw Error('fialed')
  }
  
  return new Promise((G, F) => {
    let K = '/url/' + c + '/' + z(c, S) + '/' + q
    console.log('🔍 [调试] 请求路径:', K)
    console.log('🔍 [调试] 请求头:', P)
    
    w('http://97.64.37.235/flower/v1' + K, {
      method: 'GET',
      headers: P,
    }, (b, D) => {
      console.log('🔍 [调试] 响应错误:', b)
      console.log('🔍 [调试] 响应数据:', D?.body)
      
      if (b) return F(b)
      if (D.body.code !== 0) return F(Error(D.body.msg))
      
      console.log('🔍 [调试] 最终URL:', D.body.data)
      G(D.body.data)
    })
  })
})
```

---

## 方法 5：在模拟器中启用自动断点

### 修改 `index.js`：

找到 `executeScript` 方法中的这一行：
```javascript
// debugger; // 取消注释这行可以在脚本执行前自动暂停
```

改为：
```javascript
debugger; // 脚本执行前自动暂停
```

然后按 F5 调试，程序会在执行自定义源脚本前暂停。

---

## 实用调试技巧

### 1. 查看 HTTP 请求

模拟器已经自动输出所有 HTTP 请求：
```
[HTTP] GET http://97.64.37.235/flower/v1/url/kw/1234567/320k
[HTTP Error] 或 [Result]
```

### 2. 条件断点

右键断点 → "编辑断点" → 添加条件：
```javascript
source === 'kw' && quality === '320k'
```
只有当条件满足时才会暂停。

### 3. 日志点（Logpoint）

右键行号 → "添加日志点"：
```javascript
source: {source}, quality: {quality}
```
不会暂停程序，只会输出日志。

### 4. 查看变量

在调试暂停时：
- 鼠标悬停在变量上查看值
- 在调试控制台输入变量名查看
- 在监视面板添加表达式

### 5. 调用堆栈

查看左侧调用堆栈面板：
```
callAPI (index.js:520)
getMusicUrl (index.js:540)
main (test-flower.js:55)
```

---

## 快捷键速查

| 功能 | Windows/Linux | Mac |
|------|---------------|-----|
| 开始调试 | F5 | F5 |
| 继续 | F5 | F5 |
| 单步跳过 | F10 | F10 |
| 单步进入 | F11 | F11 |
| 单步跳出 | Shift+F11 | Shift+F11 |
| 重启调试 | Ctrl+Shift+F5 | Cmd+Shift+F5 |
| 停止调试 | Shift+F5 | Shift+F5 |
| 切换断点 | F9 | F9 |

---

## 调试示例场景

### 场景 1：调试音乐 URL 获取失败

1. 在 `flower-v1.js` 的请求回调处设置断点
2. 按 F5 开始调试
3. 查看 `D.body` 的内容
4. 检查 `D.body.code` 和 `D.body.msg`

### 场景 2：调试请求头生成

1. 在生成 `P.tag` 的地方设置断点：
```javascript
P.tag = T.buffer.bufToString(
  T.buffer.from(JSON.stringify(K.match(/(?:\d\w)+/g), null, 1)),
  'hex'
)
```
2. 查看 `K` 的值
3. 查看正则匹配结果
4. 查看最终的 `P.tag`

### 场景 3：调试初始化失败

1. 在 `index.js` 的 `executeScript` 方法开头添加断点
2. 单步执行，查看脚本加载过程
3. 检查 `globalThis.lx` 是否正确初始化
4. 查看脚本是否调用了 `send(EVENT_NAMES.inited)`

---

## 常见问题

### Q: 断点没有生效？
A: 
- 确保使用 F5 调试而不是直接运行
- 检查断点是否在可执行代码行
- 查看断点是否被禁用（灰色）

### Q: 看不到自定义源脚本？
A: 
- 已添加 `sourceURL` 注释，脚本会显示为 `custom-source-script.js`
- 可以在调试控制台查看 `globalThis.lx.currentScriptInfo.rawScript`

### Q: 如何查看 HTTP 响应？
A: 
- 查看控制台输出的 `[Result]` 日志
- 在回调函数中设置断点查看 `resp` 对象

### Q: 如何跳过模拟器代码只调试自定义源？
A: 
- 在 `launch.json` 中添加：
```json
"skipFiles": [
  "${workspaceFolder}/lx-env-simulator/index.js"
]
```

---

## 高级技巧

### 1. 源码映射

模拟器已自动添加 `//# sourceURL=custom-source-script.js`，使 eval 的代码在调试器中可见。

### 2. 远程调试

如果需要在其他机器调试：
```bash
node --inspect=0.0.0.0:9229 test-flower.js
```

然后在本地浏览器访问：
```
chrome://inspect
```

### 3. 性能分析

使用 Chrome DevTools 的 Performance 面板分析：
```bash
node --inspect test-flower.js
```

---

## 推荐调试流程

1. **首次运行** - 先不加断点，看看整体流程和日志
2. **发现问题** - 根据错误信息定位问题区域
3. **设置断点** - 在可疑位置设置断点
4. **单步调试** - F10/F11 逐步执行
5. **查看变量** - 检查变量值是否符合预期
6. **修改代码** - 修复问题
7. **重新测试** - Ctrl+Shift+F5 重启调试

---

现在你可以开始调试了！按 F5 启动调试器。🐛✨
