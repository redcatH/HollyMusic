# Subsonic API 实现文档

本项目实现了 Subsonic API 的子集，用于提供音乐搜索和播放功能。

## 协议版本

- Subsonic API 版本: 1.16.1
- 参考文档: https://www.subsonic.org/pages/api.jsp

## 认证方式

当前使用硬编码的 API Key 进行简单认证（临时方案）。

**硬编码 API Key**: `my-temporary-key`

所有请求必须包含以下参数：
- `u`: 用户名（任意值）
- `t`: token（当前为 API Key，值为 `my-temporary-key`）
- `s`: salt（任意值，至少6位）
- `v`: 客户端协议版本（建议 1.16.1）
- `c`: 客户端名称（任意值）
- `f`: 返回格式，可选值: xml（默认），当前仅支持 XML

**TODO**: 未来将实现标准的 md5(password+salt) 认证机制。

## 已实现的接口

### 1. ping - 测试连通性

**用途**: 测试服务器连通性和认证

**请求地址**: `http://localhost:3000/api/subsonic/ping`

**HTTP 方法**: GET 或 POST

**参数**: 仅通用参数（见上方认证方式）

**示例请求**:
```
http://localhost:3000/api/subsonic/ping?u=joe&t=my-temporary-key&s=abc123&v=1.16.1&c=myapp
```

**成功响应**:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<subsonic-response xmlns="http://subsonic.org/restapi" status="ok" version="1.16.1"></subsonic-response>
```

**失败响应**（错误的 token）:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<subsonic-response xmlns="http://subsonic.org/restapi" status="failed" version="1.16.1"><error code="40" message="Wrong username or password"/></subsonic-response>
```

**失败响应**（缺少参数）:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<subsonic-response xmlns="http://subsonic.org/restapi" status="failed" version="1.16.1"><error code="10" message="Required parameter is missing: t"/></subsonic-response>
```

## 错误代码

| 代码 | 说明 |
|-----|------|
| 0 | 一般性错误 |
| 10 | 缺少参数 |
| 20 | 客户端版本过低 |
| 30 | 服务端版本过低 |
| 40 | 用户名或密码错误 |
| 50 | 无权限 |
| 60 | Subsonic 试用期已结束 |
| 70 | 未找到请求的数据 |

## 待实现的接口

以下接口将在后续步骤中逐步实现：

- [ ] `search2` - 搜索歌曲/专辑/歌手
- [ ] `getSong` - 获取歌曲信息
- [ ] `stream` - 歌曲播放链接（TODO: 代理或重定向到已有播放 URL）
- [ ] `getCoverArt` - 封面图片

## 开发测试

### 使用浏览器测试
直接在浏览器地址栏输入完整 URL（包含所有必需参数）。

### 使用 curl 测试
```bash
curl "http://localhost:3000/api/subsonic/ping?u=joe&t=my-temporary-key&s=abc123&v=1.16.1&c=myapp"
```

### 使用 Postman 测试
1. 创建新请求，方法选择 GET
2. URL: `http://localhost:3000/api/subsonic/ping`
3. 添加 Query Parameters:
   - u: joe
   - t: my-temporary-key
   - s: abc123
   - v: 1.16.1
   - c: myapp

## 已知限制

1. 认证方式：当前使用硬编码 API Key，未实现标准的 md5(password+salt) 验证
2. 返回格式：仅支持 XML，不支持 JSON/JSONP
3. 用户管理：未实现真实的用户系统
4. 转码功能：未实现（stream 接口将直接代理原始媒体）
5. 播放统计：未实现 scrobble 等播放记录功能
6. 完整歌单管理：未实现 playlist 的完整 CRUD 操作

## 后续改进计划

1. 从环境变量或数据库读取 API Key
2. 实现标准的 md5(password+salt) 认证
3. 可选支持 JSON 格式返回
4. 实现完整的 stream 转码与代理策略
5. 添加请求日志和监控
