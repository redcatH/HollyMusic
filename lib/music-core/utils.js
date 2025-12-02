// Common helper utilities for music-core
function formatPlayTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00'
  const sec = Math.floor(seconds)
  const min = Math.floor(sec / 60)
  const hour = Math.floor(min / 60)
  if (hour > 0) return `${hour.toString().padStart(2, '0')}:${(min % 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`
  return `${min.toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`
}

function sizeFormate(bytes) {
  if (!bytes || bytes === 0) return '0B'
  const k = 1024
  const sizes = ['B', 'K', 'M', 'G', 'T']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(2) + sizes[i]
}

function dateFormat(ts, _fmt) {
  if (!ts) return ''
  const d = new Date(ts)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function formatPlayCount(n) {
  if (!n && n !== 0) return '0'
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿'
  if (n >= 10000) return Math.floor(n / 10000) + '万'
  return String(n)
}

function formatSingerName(singers, key = 'name') {
  if (!Array.isArray(singers)) return ''
  return singers.map(s => (s && s[key]) || s).filter(Boolean).join('、')
}

module.exports = {
  formatPlayTime,
  sizeFormate,
  dateFormat,
  formatPlayCount,
  formatSingerName,
}
