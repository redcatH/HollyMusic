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
| A: 纯 songmid（原始实现） | `songmid` | 125 | 123 | **2** | ✗ 有重复 |
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

kg 搜索去重逻辑（`music-search.js`）用 `Audioid + FileHash` 作 key，即**同 Audioid 不同 FileHash 是不同条目**（同一首歌的不同文件版本）。Audioid 不唯一，必须用 FileHash 才能区分。

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

## 五、最终采用方案：分离「原始数据」与「查询键」

> 注：本节为最终实现方案，取代早期"方案C"的初步结论。

### 核心思想

DB 的 `MusicInfo` 行分离两个字段：
- **`data` 列**（原始数据）：`JSON.stringify(mi)`，songmid 保持各源原值（kg=Audioid）。播放时从这里拉起完整 musicInfo 丢给外部脚本，保证结构正确。
- **`songmid` 列**（查询键/对外 id 的一部分）：kg 用 `FileHash`（唯一），其他源用原 songmid（已唯一）。

### 为什么 kg 用 FileHash 而非 Audioid

kg 的 Audioid 不唯一（同歌多版本）。若用 Audioid 作查询键：
- 同 Audioid 多条记录复合键冲突，upsert 互相覆盖
- 用户点的版本 B 可能被版本 A 覆盖，取出错误的 FileHash → 播错版本

FileHash 唯一，每个版本独立 id，精确取出用户点的那个版本。

### 为什么不担心"播放需要 hash"

`formatItem`（`music-search.js`）已把每个音质的 hash 存进 `_types`：
```
_types['128k'].hash = FileHash
_types['320k'].hash = HQFileHash
_types.flac.hash   = SQFileHash
_types.flac24bit.hash = ResFileHash
```
播放时从 `data` 列的 `_types[quality].hash` 取对应音质 hash，**与 songmid 存什么无关**。

### 数据流

```
入库 (upsertMusicInfo):
  data 列   = JSON.stringify(mi)              ← 原始数据，songmid=Audioid
  songmid 列 = getStorageSongmid(mi)          ← kg=FileHash，其他=原songmid
  复合唯一键 = (source, songmid列)

对外 id (search/getStarred):
  source-{存储songmid}  = kg-FileHash / kw-原songmid / ...

  与 DB songmid 列一致

播放 (stream):
  stream?id=kg-FileHash
  → resolveMusicInfoById 解析 (kg, FileHash)
  → getMusicInfo 精确命中 (findUnique 复合唯一键)
  → 读 data 列原始 musicInfo
  → 丢给外部脚本 → 正常播放
```

### 各源情况

| 源 | 原始 songmid (data列) | 存储键 (songmid列) | 对外 id |
|----|---------------------|-------------------|---------|
| kg | Audioid | **FileHash** | `kg-{FileHash}` |
| kw | MUSICRID | MUSICRID | `kw-{MUSICRID}` |
| tx | item.mid | item.mid | `tx-{mid}` |
| wy | item.id | item.id | `wy-{id}` |
| mg | item.songId | item.songId | `mg-{songId}` |

只有 kg 的原始值与存储键不同，其他源都相同。

## 六、数据库影响

- **Schema 零改动**，无需 migration。
- `data` 列存原始 musicInfo，`songmid` 列存查询键（kg=FileHash）。
- `Favorite.itemId`、`PlaylistEntry.songmid` 存 `source-存储songmid` 复合字符串。
- **清空旧数据后重新搜索/收藏即可**。

## 七、复现命令

```bash
node scripts/test-search-id.js 周杰伦 20
# 原始数据保存到 scripts/search-id-output/search-<timestamp>.json
```
