/** 仅描述 Web Audio 链路；媒体加载、解码和重试由播放器负责。 */
export type EqualizerStatus =
  | 'idle'
  | 'awaiting-gesture'
  | 'running'
  | 'unsupported'
  | 'unsupported-source'
  | 'resume-blocked'
  | 'interrupted'
  | 'initialization-failed'

export const EQ_STATUS_MESSAGES: Record<EqualizerStatus, string> = {
  idle: '',
  'awaiting-gesture': '音效将在下一次点击或触摸时启用。',
  running: '',
  unsupported: '此浏览器不支持 Web Audio，保留原生播放。',
  'unsupported-source': '此跨域音源未接入 EQ。请通过同源 /api/audio 代理播放；直连需要服务端正确提供 CORS 响应头。',
  'resume-blocked': '音效尚未获准运行，请点击播放按钮重试。',
  interrupted: '系统暂停了音效，请通过播放按钮恢复；歌曲进度和队列会保留。',
  'initialization-failed': '无法启用音效，保留原生播放。请检查浏览器音频权限。',
}
