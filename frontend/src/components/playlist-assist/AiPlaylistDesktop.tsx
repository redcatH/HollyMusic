/**
 * AI 协助建歌单 - PC 端向导壳
 * 居中卡片 + 左右分栏（左侧步骤导航 + 右侧内容），桌面端友好。
 * 逻辑复用 useAiPlaylist，UI 独立于移动端。
 */

import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { AiPlaylistController } from '@@/hooks/useAiPlaylist'
import { StepIndicator } from '@@/components/playlist-assist/StepIndicator'
import { StepInput } from '@@/components/playlist-assist/StepInput'
import { StepCandidates } from '@@/components/playlist-assist/StepCandidates'
import { StepProcessing } from '@@/components/playlist-assist/StepProcessing'
import { StepConfirm } from '@@/components/playlist-assist/StepConfirm'

const STEP_TITLES = ['描述需求', '确认候选', '搜索筛选', '确认创建']

const variants = {
  enter: (dir: number) => ({ x: dir > 0 ? 30 : -30, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -30 : 30, opacity: 0 }),
}

export function AiPlaylistDesktop({ ai }: { ai: AiPlaylistController }) {
  const navigate = useNavigate()
  const close = () => navigate('/playlists')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="flex h-[640px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        {/* 顶栏 */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold">AI 建歌单</h1>
            <span className="text-xs text-muted-foreground">{STEP_TITLES[ai.step]}</span>
          </div>
          <button
            onClick={close}
            className="touch-target flex items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 进度条 */}
        <div className="border-b border-border px-5 py-3">
          <StepIndicator current={ai.step} />
        </div>

        {/* 内容区 */}
        <div className="relative flex-1 overflow-hidden">
          <AnimatePresence custom={ai.direction} mode="wait">
            <motion.div
              key={ai.step}
              custom={ai.direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="absolute inset-0 flex flex-col"
            >
              {ai.step === 0 && (
                <StepInput
                  prompt={ai.prompt}
                  setPrompt={ai.setPrompt}
                  generating={ai.generating}
                  generateError={ai.generateError}
                  sources={ai.sources}
                  sourcesLoading={ai.sourcesLoading}
                  onGenerate={ai.runGenerate}
                />
              )}
              {ai.step === 1 && ai.generateResult && (
                <StepCandidates
                  generateResult={ai.generateResult}
                  selectedItems={ai.selectedItems}
                  toggleItem={ai.toggleItem}
                  playlistName={ai.playlistName}
                  setPlaylistName={ai.setPlaylistName}
                  onBack={() => ai.goBack(0)}
                  onNext={ai.runProcess}
                />
              )}
              {ai.step === 2 && (
                <StepProcessing processing={ai.processing} onRetry={ai.runProcess} onBack={() => ai.goBack(1)} />
              )}
              {ai.step === 3 && (
                <StepConfirm
                  confirmSongs={ai.confirmSongs}
                  selectedUids={ai.selectedUids}
                  toggleUid={ai.toggleUid}
                  processing={ai.processing}
                  creating={ai.creating}
                  createError={ai.createError}
                  createdId={ai.createdId}
                  onBack={() => ai.goBack(2)}
                  onCreate={ai.createPlaylistAndSongs}
                  onView={() => navigate(`/playlists/${ai.createdId}`)}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
