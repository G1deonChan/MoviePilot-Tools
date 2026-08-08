// 格式化纯函数工具

/** 字节大小 → 人类可读（如 1.2 GB） */
export function formatSize(bytes?: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / Math.pow(1024, i)
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 数字千分位 */
export function formatNumber(n: number): string {
  return n.toLocaleString('zh-CN')
}

/** 时间戳 → YYYY-MM-DD HH:mm */
export function formatTime(ts: number): string {
  if (!ts) return '-'
  const d = new Date(ts * 1000)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 魔力值简写（如 1.2k / 3.4M） */
export function formatBonus(bonus?: number): string {
  const n = bonus || 0
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return n.toFixed(0)
}

/** 下载任务字节大小，最多保留两位小数 */
export function formatFileSize(bytes?: number): string {
  const value = bytes || 0
  if (value === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  return `${parseFloat((value / Math.pow(1024, index)).toFixed(2))} ${units[index]}`
}

/** ISO 日期时间 → YYYY-MM-DD HH:mm，无效输入原样返回 */
export function formatDateTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 日期 → 中文年月日，无值返回“未知”，无效输入原样返回 */
export function formatDate(value?: string): string {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

/** 根据字符串稳定选择颜色或渐变 */
export function stablePaletteValue(value: string, palette: readonly string[]): string {
  if (!palette.length) return ''
  let hash = 0
  for (let index = 0; index < value.length; index++) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash)
  }
  return palette[Math.abs(hash) % palette.length]
}
