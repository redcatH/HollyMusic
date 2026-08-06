/**
 * AI 协助建歌单 - 移动端向导壳
 * fixed inset-0 全屏沉浸 + safe-area + 底部操作栏。
 * 逻辑复用 useAiPlaylist，UI 独立于 PC 端。
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

const variants = {
  enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
}

export function AiPlaylistMobile({ ai }: { ai: AiPlaylistController }) {
  const navigate = useNavigate()
  const close = () => navigate('/playlists')

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* 顶部：关闭 + 进度（safe-area-top 避刘海） */}
      <div className="safe-area-top flex h-14 shrink-0 items-center gap-2 border-b border-border px-2">
        <button
          onClick={close}
          className="touch-target flex items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
          aria-label="关闭"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex-1 px-1">
          <StepIndicator current={ai.step} />
        </div>
      </div>

      {/* 内容：方向感步骤切换（safe-area-bottom 避开手势条） */}
      <div className="relative flex-1 overflow-hidden safe-area-bottom">
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
  )
}
