# 10 段均衡器

## 架构与入口

实际架构为 Next.js 16 API + Vite/React 19 SPA，共享组件、hooks 和 Zustand store；界面使用 Tailwind v4、Lucide 和自有 Modal/PlayerButton，无新增依赖。外观支持跟随系统、明暗及三套配色。EQ 入口位于桌面播放栏和手机「更多」菜单。

播放器由 `hooks/useAudioPlayer.ts` 管理单一 HTMLAudioElement，`PlayerBar` 对接 Zustand 播放队列、播放意图、URL/音质切换和进度恢复。歌曲通过同源 `/api/audio` 的 Range 代理，完整离线歌曲使用 blob URL。EQ 未改变这些机制。

原有 `lib/client/audio-analysis.ts` 已负责频谱 AudioContext。现在扩展该模块，不再创建第二套媒体源：

```
HTMLAudioElement（原有音量、静音、淡入淡出）
 → MediaElementAudioSourceNode（每个元素一次）
 → 10 × peaking BiquadFilterNode（31 / 62 / 125 / 250 / 500 / 1k / 2k / 4k / 8k / 16k）
 → 手动 Preamp GainNode
 → 自动 Protection GainNode
 → 原有 AnalyserNode
 → AudioContext.destination
```

没有额外 ReplayGain 或压缩器。各段 Q 根据设备采样率求解，使数字滤波器的半增益边界频率比为 2（一倍频程，边界不必围绕中心几何对称）。滑块目标及手动前级均为 ±12dB；内部用带阻尼的 Newton 迭代补偿频段交互，使可用中心频点接近滑块目标。节点增益内部限制 ±24dB，最多 10 次迭代，并对 32 组近期设计缓存。低采样率下超出可用范围的频段保留配置并禁用，不再将它们挤到 Nyquist 附近。关闭时将各滤波器平滑归零、两个增益归一，形成透明旁路；参数仍保留，不断开媒体或重置播放。滤波器采用 15ms 时间常数平滑变更；优先使用 cancelAndHoldAtTime 保持当前值，不支持的内核由跟踪的指数时间线精确计算当前值并 setValueAtTime 锚定，避免快速重调度回跳。保护先快速衰减，再在音频时钟上调度释放，不依赖后台 JS 定时器。切歌仅替换同一元素的 src。

图表及保护采用与 Web Audio peaking 相同的 RBJ 系数、补偿后的实际节点增益和设备实际采样率。保护扫描 1024 个对数频点并补充所有中心频率，累计级联响应，加上手动前级，必要时额外留出 0.5dB 余量。首次媒体源接入之前先落位滤波、前级与保护，避免首帧提升。切换期间按当前运行值和新目标的增益上包络保护；当前值从完整自动化时间线计算，避免以“上次目标”替代尚未完成的参数变化。响应曲线显示最终稳态输出响应；切换的短暂过渡不画入曲线。软件余量不能保证所有瞬态及所有音源绝不削波。

## 配置与生命周期

复用外观设置的 Zustand + localStorage 模式，键为 `holly-equalizer`。结构包含 version=1、settings 和至多 20 个用户预设。读入验证所有字段、10 段数量、有限值及 ±12dB 范围；支持无版本旧配置迁移，损坏/未来版本回退默认。音频更新同步，写盘防抖 150ms，pagehide 强制保存；存储失败保留会话操作。系统预设集中在 `lib/client/equalizer.ts`，手动调节自动转为 Custom，重置保留用户保存的预设。

WeakMap 复用/去重共享链路。只有用户手势创建且确认 context 已 running 才接管元素；resume 超时不接管。播放器销毁会撤销订阅、事件监听、断开节点、关闭 context；频谱布局卸载不会销毁播放器资源。visible/pageshow、媒体 play 和用户手势尝试恢复被挂起或中断的 context，恢复不调用 play/load/seek、不改变队列。

EQ 运行状态使用 `EqualizerStatus`，提示文案集中在 `equalizer-status.ts`。EQ 只负责 Web Audio 支持情况、接入条件、初始化和 context 中断/恢复；普通媒体加载、解码、主动取消及音质重试仍由 `useAudioPlayer` 统一处理。媒体 error 不写 EQ 状态，playing 也不能证明 context 已恢复。context 恢复后清除自身提示；已销毁链路的异步结果不能覆盖新播放器状态。运行状态不持久化。

## 网页与 PWA

继续使用现有 manifest（standalone）、Service Worker 及 Modal 安全区域处理，无另一套 PWA 或 standalone 分支。配置独立于 SW 内存，网页刷新及 PWA 重启从 localStorage 恢复，等待浏览器允许的交互启用音频图。

Service Worker 原本仅缓存构建清单资源，跳过 `/api/`、`/rest/`、跨域和写入请求；本次额外明确跳过 Range、Authorization 和 audio destination。离线歌曲仍由原有离线缓存负责。

iOS/iPadOS 原先为避免破坏原生后台播放而不接入频谱音频图。本次仍默认保留该行为；只有明确启用 EQ 才允许接管。系统可能在锁屏或后台挂起 Web Audio，回前台或操作播放按钮时尝试恢复。由于媒体源接管不可逆，关闭 EQ 只旁路滤波；如需恢复原生后台输出，关闭后刷新页面。普通网页、PWA 都不能绕过操作系统限制。

媒体元素原有 `crossOrigin='anonymous'` 在 src 之前设置。正式链路只接入同源或 blob 音源，跨域直连拒绝接管并提示使用同源代理；如后续支持直连，需要上游（包括重定向和 206 Range）返回正确的 Access-Control-Allow-Origin，凭据请求还需相应 credentials 配置。CORS 失败不能靠 Web Audio 解除，也不能仅凭零电平认定 CORS（静音曲段也会为零）。媒体 error 本身不能确定是 CORS 问题，EQ 不再为它附加跨域错误提示。

## 自动验证

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run --maxWorkers=1
NODE_OPTIONS=--no-experimental-webstorage pnpm -C frontend exec vitest run
pnpm build:all
node scripts/check-equalizer-response.mjs
```

Node 26 环境的前端测试使用 `--no-experimental-webstorage`，避免 Node 自身未配置文件的 experimental localStorage 遮挡 jsdom 存储；正常浏览器不需要此参数。原生对照脚本需要 Node.js 22+（内置 WebSocket）及本机 Chromium 浏览器，无新增 npm 依赖。通过 `CHROME_BIN` 指定 Chrome/Edge 可执行文件；未设置时 macOS 使用默认 Chrome 路径，其他平台查找 `chromium`。

脚本转译实际生产模块，由 `equalizer-browser-checks.js` 在浏览器执行，通过 CDP 等待 OfflineAudioContext 渲染完成。验收分开记录：

| 检查 | 场景与判据 |
| --- | --- |
| 静态频响 | 22.05/32/44.1/48/96kHz × 全部系统预设及全段 +12dB，共 50 项；模型与原生误差 <0.0001dB，中心目标误差 <0.05dB |
| 参数连续性 | 48kHz DC/1kHz 正弦 × 原生 hold/fallback，共 4 项；每 8ms 调节前级或极限交替 EQ，保留原有相邻样本跳变与峰值门限 |
| 保存不改变声音 | 同一输入、滤波图、初始摇滚/−12dB 前级和旁路时刻，比较保存 40 次与不操作的完整波形；5 种采样率 × 6 个频点 × hold/fallback，共 60 项，逐样本最大差 <1e-7 |
| 旁路还原 | 独立与直通渲染比较；包含上述 60 组输入及 4 组快速调节，共 64 项。0.5s 关闭 EQ，测量 1–2s 窗口；增益差绝对值 <0.1dB，归一化 RMS 差 <1% |
| 反向对照 | hold/fallback 下故意让保存改变 0.1dB 前级，以及让旁路多出 0.1dB 增益；两类错误均必须被对应判据拒绝 |

六个频点为 DC、31/125/1000/8000Hz 和 `min(16000, 0.4 × 采样率)`，高频测试保持在 Nyquist 以下。保存断言只测操作引起的差异，不能用整条滤波链相对理想 DC 的误差代替。旁路的两个门限是本项目的工程验收目标，分别限制幅度差和包括相位在内的波形差；不承诺原生 IIR 自动化结束后逐位还原。快速调节的旁路也独立验收，不能以曲线或 AudioParam 数值归零替代实际输出检查。

CI 在已有 required `check` job 内执行此脚本；应用原有检查使用 Node 20，原生音频步骤使用 Node 22 和 Ubuntu runner 预装的 Chrome，日志记录浏览器版本及各项误差。浏览器随 runner 镜像更新，升级后的失败仍需复核，不能自动放宽门限。这些检查不替代真实扬声器、移动设备或后台播放验收。

测试覆盖配置回退/迁移、预设切换/保存/删除/重置、持久化及写入失败、Flat/单段/级联频响、自动保护、同元素并发初始化、实时节点更新/旁路、切源复用、context 恢复不影响媒体、清理、iOS 主动启用及跨域拒绝策略；另有面板操作和 SW 排除请求测试。新增媒体四类错误及同源音质重试不影响 EQ、真实中断不被媒体事件掩盖、恢复清理与旧链路异步结果隔离的回归用例。

## 真实设备手工验收（待执行）

在 Chrome、Edge 桌面、macOS Safari、Android Chrome 浏览器及已安装 PWA、iOS/iPadOS Safari 及主屏 Web App 逐一执行：

1. 播放歌曲后打开均衡器，核对 10 个频段数值、±12dB 上下限、键盘方向键与手机触摸拖动；快速连续调节，应实时变化，无突发爆音、异常静音、双路输出或明显卡顿。
2. 依次切换九种预设，手动调节应转为 Custom；保存两个自定义、切换恢复、删除其中一个、恢复默认。确认重置仍保留另一个用户预设。
3. 调整手动前级、开关保护，以相邻多段提升核对保护值与曲线；开启/关闭 EQ，确认关闭后原声恢复，再开恢复参数。使用不同音量的音源检查响度与失真，避免高音量试音。
4. 开关 EQ 的两种状态下，分别播放/暂停/继续、seek 到已缓冲及未缓冲区、前后切歌、快速切歌、切换队列、切音质/音源、音量/静音、自然结束与循环。原有进度与队列应稳定。
5. 刷新、完全关闭重开 PWA，核对参数及用户预设恢复；浏览器阻止自动播放时按提示交互恢复，不应因恢复音效重置进度或额外播放。
6. 前后台切换、锁屏后解锁、电话/其他音频应用中断后返回，核对 context 提示及通过播放按钮恢复的行为。单独记录 iOS 后台限制；关闭 EQ 并刷新后核对原生播放行为。
7. Android/iOS 竖屏和横屏检查滑块横向滚动、弹窗内部滚动、安全区域、预设名称输入时键盘及深浅主题；检查关闭/ESC/焦点恢复。
8. 联网播放后断网播放已缓存歌曲，确认 EQ 可用；在网络面板检查音频 206 Range、授权接口不进入 SW 应用壳缓存。模拟拒绝 CORS、网络失败及 Web Audio 权限失败，应看到提示，不能把无法加载的源误报为正在正常处理。

尚未声称完成上述实机验收，尤其是 iOS/Android standalone、系统中断和锁屏背景行为。

## 文件清单

| 类型 | 文件 | 用途 |
| --- | --- | --- |
| 新增 | `lib/client/audio-param-smoother.ts` | 原生/兼容自动化保持及指数时间线 |
| 新增 | `lib/client/equalizer-automation.ts` | 实际节点参数应用、启动初始化与过渡保护 |
| 新增 | `lib/client/equalizer-status.ts` | EQ 运行状态类型及统一提示文案 |
| 新增 | `lib/client/audio-param-smoother.test.ts` | 重调度连续性与未来事件清理测试 |
| 新增 | `lib/client/equalizer.ts` | 配置校验/迁移、频段、系统预设、频响及保护算法 |
| 新增 | `lib/store/equalizer-store.ts` | Zustand 状态、自定义预设、持久化 |
| 新增 | `components/player/EqualizerPanel.tsx` | 面板、曲线与入口按钮 |
| 修改 | `lib/client/audio-analysis.ts` | 扩展共享链路、恢复与清理 |
| 修改 | `hooks/useAudioPlayer.ts` | 播放器绑定 EQ 生命周期 |
| 修改 | `components/player/PlayerBar.tsx` | 传递共享 Audio 元素 |
| 修改 | `components/player/PlayerTools.tsx` | 桌面入口 |
| 修改 | `components/player/MobilePlayerMenu.tsx` | 手机入口 |
| 修改 | `components/player/AudioSpectrum.tsx` | 更新 iOS 主动开启 EQ 的说明 |
| 修改 | `public/sw.js` | 排除 Range/授权/音频请求 |
| 修改 | `lib/service-worker.test.ts` | SW 回归验证 |
| 新增 | `lib/client/equalizer.test.ts` | 配置与信号模型测试 |
| 新增 | `frontend/components/Equalizer.test.tsx` | 状态与共享音频图测试 |
| 新增 | `frontend/components/EqualizerPanel.test.tsx` | UI 交互测试 |
| 新增 | `scripts/check-equalizer-response.mjs` | 原生 Chromium 频响对照 |
| 新增 | `scripts/equalizer-browser-checks.js` | 原生频响、连续性、保存与旁路独立验收 |
| 修改 | `.github/workflows/ci.yml` | required check 纳入原生音频验收 |
| 新增 | `docs/equalizer.md` | 架构、限制与验收步骤 |

## 本次验证结果（2026-10-19）

- `pnpm typecheck`：通过。
- `pnpm lint`：0 errors，32 条既有 warnings，本次 EQ 文件无告警。
- 根目录测试 `--maxWorkers=1`：58 个文件，572 项通过。
- 前端测试：30 个文件、286 项全量通过；其中 EQ 链路与面板 21 项。测试运行于 Windows / Node 24.15.0。
- `pnpm build:all`：Next.js、前端 TypeScript/Vite、SW 构建均成功；Vite 提示现有主包大于 500kB。
- Windows Chrome 155.0.8059.80、Edge 155.0.4283.62 原生验收均通过：50 项频响、4 项连续性、60 项保存对照、64 项旁路及两种自动化路径下的反向对照。模型与原生最大误差约 0.0000037dB，中心目标最大误差约 0.0047dB；保存操作的逐样本差为 0。
- 原生旁路实测最大增益差约 0.06238dB、归一化 RMS 差约 0.7156%，均出现在 96kHz DC 场景。旧脚本的单样本/理想 DC 断言在本机确实失败；现改用上述分项判据，保留残差记录，不再声称逐位还原或将此残差归因于保存操作。
- `git diff --check`：通过。
- 未进行真实设备音质试听、Safari 及移动 PWA/锁屏验收；桌面 Chrome/Edge 自动化不能替代上文手工清单。

Web Audio 接口参考：[createMediaElementSource](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaElementSource)、[resume](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume)。


## 校准范围

原始频点（31/62 等）按产品需求保留。系统预设和用户保存的数据结构保持兼容，但滑块现在解释为中心频点的目标增益，旧预设的实际声音会因带宽与交互补偿而变化。单元测试覆盖 5 种采样率、所有系统预设、全段提升、正负极限交替及确定性随机配置；中心误差要求 <0.05dB。此阈值是本项目工程验收目标，不是 ISO/IEC 认证；频点之间仍由有限阶滤波器决定，不保证任意插值目标、真峰值不超限或全平台绝无爆音。


## 负前级与 iOS 初始化竞态修复

- 确认旧实现将负前级的瞬态上界截为 0dB，导致已有衰减被忽略。现在以正在运行的手动前级和目标前级的真实较大值计算，保留负前级的保护余量。
- 仅修改预设标识、保存预设或换成内容相同的频段数组，不再重调度节点，保持已有自动化继续运行。
- iOS 等待 context.resume() 后，再次确认 EQ 仍启用；已关闭则释放尚未接管的 context，不创建媒体源。超时后已关闭 EQ 的场景也不再发送无关的恢复提示。
- 这些行为由负前级保护、预设元数据不触发重调度、iOS 初始化竞态用例持续覆盖；原生验证使用成对波形检查负前级下重复保存预设，不包含实际 iOS 后台实机验收。
