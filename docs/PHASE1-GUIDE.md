# 🎵 阶段 1 - 基础布局框架完成指南

## ✅ 已完成的工作

### 创建的核心文件：
- `lib/store.ts` - Zustand 全局状态管理
- `components/layout/Header.tsx` - 顶部导航栏（搜索框、深色模式开关）
- `components/layout/Sidebar.tsx` - 左侧菜单（导航、响应式）
- `components/layout/BottomPlayer.tsx` - 底部播放器占位符
- `components/layout/MainLayout.tsx` - 布局容器
- `app/page.tsx` - 主页面（CSR）

### 新增依赖包：
- `zustand@^4.4.7` - 状态管理
- `framer-motion@^11.0.8` - 动画库
- `react-window@^1.8.10` - 虚拟滚动
- `react-use@^17.5.0` - 通用 hooks
- `dexie@^4.0.8` - IndexedDB 包装

## 🚀 如何测试

### 1. 安装新依赖
```powershell
cd D:\work\user\online\linux\new\lxmuisc\lx-music-desktop-master\web\my-music
pnpm install
```

### 2. 启动开发服务器
```powershell
pnpm dev
```

### 3. 访问应用
```
http://localhost:3000
```

### 4. 测试功能
- ✅ 响应式布局（桌面、平板、手机）
- ✅ 深色/浅色模式切换（右上角月亮图标）
- ✅ 移动端侧边栏（点击汉堡菜单）
- ✅ 底部播放器占位符（显示"选择一首歌曲"）

## 📐 布局结构

```
┌─────────────────────────────────┐
│      Header（导航栏）            │
├──────────────┬──────────────────┤
│              │                  │
│   Sidebar    │   主内容区       │
│  (265px)     │  (响应式)        │
│              │                  │
├──────────────┴──────────────────┤
│      BottomPlayer（h-24）        │
└─────────────────────────────────┘
```

### 响应式设计：
- **移动端 (< 768px)**：侧边栏可隐藏/显示，汉堡菜单控制
- **平板端 (768px - 1024px)**：完整布局
- **桌面端 (> 1024px)**：固定侧边栏，完整布局

## 🎨 主题系统

### 状态管理 (Zustand)
```typescript
const { isDarkMode, toggleDarkMode, setSidebarOpen } = usePlayerStore()
```

### CSS 类
- 深色模式：`dark:` Tailwind 前缀
- 颜色：紫色系主题 (`purple-500`, `purple-600`)

## 🔧 下一步任务（阶段 2）

继续实现搜索功能模块：
- `components/search/SearchBar.tsx` - 搜索输入框
- `components/search/SongCard.tsx` - 歌曲卡片
- `components/search/MusicList.tsx` - 结果列表
- `hooks/useSearch.ts` - 搜索 hook
- `hooks/usePagination.ts` - 分页 hook

## 🐛 常见问题

**Q: 侧边栏在移动端不显示？**
A: 检查 `sidebarOpen` 状态。可能需要刷新页面。

**Q: 深色模式颜色不对？**
A: 确保在 `MainLayout` 中添加了 `dark` 类。在浏览器开发者工具中检查 HTML 元素。

**Q: 底部播放器遮挡了内容？**
A: `main` 元素已设置 `pb-24`（padding-bottom），内容应该不会被遮挡。

## 📦 文件树
```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx              ✅
│   ├── globals.css
│   └── api/
│       ├── search/
│       ├── music-url/
│       ├── health/
│       └── cache/clear/
├── components/
│   └── layout/
│       ├── Header.tsx        ✅
│       ├── Sidebar.tsx       ✅
│       ├── BottomPlayer.tsx  ✅
│       └── MainLayout.tsx    ✅
├── lib/
│   ├── store.ts             ✅
│   ├── types/
│   │   └── music.ts
│   └── ...
└── hooks/
```
