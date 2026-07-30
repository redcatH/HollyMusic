# 搜索 id 格式测试报告

> 测试脚本: `scripts/test-search-id.js`
> 测试时间: 2026-07-30
> 关键词: 周杰伦，每源 20 条（kg/mg 因分组返回更多）

## 一、各源 songmid 来源与格式

| 源 | songmid 字段 | 格式 | 长度分布 | 辅助唯一字段 |
|----|-------------|------|---------|-------------|
| kw (酷我) | `MUSICRID.replace('MUSIC_','')` | **纯数字** | 5-9 位 | 无（songmid 本身唯一） |
| kg (酷狗) | `Audioid` | **纯数字** | 6-9 位 | `FileHash`（32位hex，唯一） |
| tx (QQ) | `item.mid` | **字母数字** | 固定 14 位 | `strMediaMid`（唯一） |
| wy (网易云) | `String(item.id)` | **纯数字** | 6-10 位 | 无（songmid 本身唯一） |
| mg (咪咕) | `item.songId` | **纯数字** | 3-10 位 | `copyrightId`（唯一） |

**关键观察**：除 tx 外，kw/kg/wy/mg 四个源的 songmid **都是纯数字**，跨源碰撞概率极高（数字 id 空间重叠）。

## 二、唯一性测试结果

对 125 条歌曲（5 源）测试三种 id 方案：

| 方案 | 格式 | 总数 | 去重后 | 重复 | 结论 |
|------|------|------|--------|------|------|
| A: 纯 songmid（当前实现） | `songmid` | 125 | 123 | **2** | ✗ 有重复 |
| B: source-songmid | `kw-228908` | 125 | 123 | **2** | ✗ 仍有重复 |
| C: source-songmid-辅助id | `kg-338638-16C8...` | 125 | 125 | **0** | ✓ 完全唯一 |

## 三、重复项定位

方案 B 的 2 个重复**全部在 kg（酷狗）源内部**，是同一首歌的 `Audioid` 相同但 `FileHash` 不同：

```
kg-338638  夜曲       hash=16C8AB298231370293D16BCF9E5FF9B6
kg-338638  夜曲       hash=F68DDC4048A40D82DD2594A294F4BAF7

kg-728206  珊瑚海     hash=90E34F0C582168E7EA857915771AB220
kg-728206  珊瑚海     hash=E1C4FFE8A623AB88421CAB8F110FB42D
```

这是酷狗的特性：同一首歌（同 Audioid）有多个版本/音质文件，每个文件有独立 `FileHash`。**仅靠 `Audioid` 无法区分这些版本**。

## 四、各源辅助字段唯一性验证

| 源 | songmid 唯一性 | 辅助字段 | 辅助字段唯一性 |
|----|---------------|---------|---------------|
| kw | ✓ 20/20 | — | — |
| kg | ✗ 26/28 | `hash` | ✓ 28/28 |
| tx | ✓ 20/20 | `strMediaMid` | ✓ 20/20 |
| wy | ✓ 20/20 | — | — |
| mg | ✓ 37/37 | `copyrightId` | ✓ 37/37 |

- tx 的 `mid` 是 14 位字母数字，**天然不与纯数字 songmid 碰撞**，跨源唯一性已验证（碰撞数=0）。
- kg 是唯一存在 songmid 内部重复的源，必须借助 `FileHash` 才能区分。

## 五、结论与 id 方案建议

### 当前问题根因
`getStarred`/`search3` 返回纯 `songmid` 作 id，`stream` 回退用 `getMusicInfoBySongmid`（`findFirst` 无 orderBy）全库模糊匹配。当 songmid 跨源碰撞或同源多版本时，会命中错误记录 → **播错歌**。

### 推荐方案：`source-songmid` + kg 特殊处理

1. **统一 id 为 `source-songmid`**（方案 B）：
   - 解决跨源碰撞（kw/kg/wy/mg 纯数字不再互相冲突，tx 天然唯一）。
   - `stream` 走精确匹配分支 `getMusicInfo(src, mid)`，不再依赖 `findFirst`。

2. **kg 源额外处理**（解决同源多版本）：
   - kg 的 songmid（Audioid）不唯一，需用 `FileHash` 区分。
   - 两种选择：
     - **(a)** kg 的 id 用 `kg-{Audioid}-{FileHash}`（即方案 C 对 kg 的应用）。
     - **(b)** kg 入库时以 `FileHash` 作 songmid（`source=kg, songmid=FileHash`），id 自然变为 `kg-{FileHash}`。
   - 推荐 (b)：与现有 `getMusicInfo(source, songmid)` 精确匹配完全兼容，无需改 stream 解析逻辑。

3. **兜底**：给 `getMusicInfoBySongmid` 加 `orderBy: { id: 'asc' }`，让回退结果确定（但不能根治，仅过渡）。

### 影响面
- `getStarred` 返回的 song id → 改为 `source-songmid`。
- `search3` 返回的 song id → 改为 `source-songmid`。
- `star`/`unstar` 的 id 归一化 → 客户端传复合 id 或服务端补全 source。
- kg 入库逻辑 → songmid 改存 FileHash（需评估对播放 URL 获取的影响）。

## 六、复现命令

```bash
node scripts/test-search-id.js 周杰伦 20
# 原始数据保存到 scripts/search-id-output/search-<timestamp>.json
```
