/**
 * 推荐任务的默认提示词（前后端共享，纯字符串常量无副作用）。
 * 前端创建表单预填用，engine 跑时若 config 未提供则用此默认值。
 *
 * user 模板用 {{artist}} {{candidates}} 占位符，engine 每歌手替换。
 */

export const DEFAULT_PROMPT_SYSTEM = '你是音乐曲库编辑。只返回 JSON, 不输出任何额外文字。'

export const DEFAULT_PROMPT_USER = `为目标歌手「{{artist}}」筛选本人正规录音室版本。

候选(序号. 歌名 | 演唱者 | 专辑):
{{candidates}}

规则:
1. 只保留「{{artist}}」本人主唱的版本(可有 feat. 客串, 但主唱须是其本人)。
2. 排除"群星/大合唱/晚会/他人翻唱"的同一首歌——即演唱者不是其本人的版本。
3. 排除 DJ版/remix/混音/伴奏/纯音乐/铃声/8bit 等非原版。
4. 同名重复只留 1 个最正规版本(优先录音室版)。
5. 演唱者里的英文名/别名/组合名变体视为同一人。

严格返回 JSON: {"selected":[序号按推荐度降序],"dropped":{"被排除序号":"≤8字原因"}}`
