import { PROJECT_URL } from '@/lib/site-settings'
import { Modal } from './Modal'

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Modal open={open} onClose={onClose} title="关于 Holly Music" size="sm">
    <p className="text-sm leading-7 text-muted-foreground">Holly Music 是一款开源的多源音乐播放器，支持自部署、PWA 与移动端使用。这个站点由 Holly Music 提供支持。</p>
    <div className="mt-5 flex flex-wrap gap-4 text-sm text-primary">
      <a href={PROJECT_URL} target="_blank" rel="noopener noreferrer">项目源码</a>
      <a href={`${PROJECT_URL}/issues`} target="_blank" rel="noopener noreferrer">反馈问题</a>
    </div>
    <p className="mt-5 text-xs text-muted-foreground">开源许可：MIT</p>
  </Modal>
}
