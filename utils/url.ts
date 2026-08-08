// URL 纯函数工具

/** 规范化服务器地址：补全协议、去尾斜杠 */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  try {
    const u = new URL(url)
    u.pathname = ''
    u.search = ''
    u.hash = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

/** 取主机名（用于凭据/站点匹配） */
export function hostnameOf(input: string): string {
  try {
    return new URL(input).hostname.replace(/^www\./i, '')
  } catch {
    return input.replace(/^www\./i, '')
  }
}

/** 判断主机是否仅适用于本机或内网，避免公网环境发起无效图标请求。 */
export function isPrivateHost(input: string): boolean {
  const raw = (input || '').trim().toLowerCase()
  if (!raw) return false

  let host = raw
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase()
  } catch {
    host = raw.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0]
  }
  host = host.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (!host.includes('.') && !host.includes(':')) return true

  if (host.includes(':')) {
    return host === '::1' || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host)
  }

  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/**
 * 主机名脱敏：仅脱敏子域，注册域（主域 + 后缀）完整保留以提升可读性。
 * 服务器地址现已仅在悬停时展示，无需逐段严格脱敏。
 * 例：a.b.example.com → *.example.com；a.b.example.co.uk → *.example.co.uk
 */
export function maskHostname(host: string): string {
  const h = (host || '').trim().toLowerCase()
  if (!h) return '***'

  // IPv4：保留首尾两段，中间脱敏（IP 更敏感，维持严格）
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split('.')
    return `${p[0]}.***.***.${p[3]}`
  }

  // IPv6 / 含冒号
  if (h.includes(':')) return '****'

  const parts = h.split('.').filter(Boolean)
  if (!parts.length) return '***'

  // 识别 com.cn / co.uk 等两段后缀，保留最后两段不脱敏；其余保留主域 + 后缀
  const last = parts[parts.length - 1]
  const secondLast = parts[parts.length - 2] || ''
  const twoLabelSuffix = parts.length >= 3 && /^[a-z]{2,3}$/i.test(last) && /^[a-z]{2,3}$/i.test(secondLast)
  const keepFrom = twoLabelSuffix ? parts.length - 3 : parts.length - 2
  // 子域全部折叠为单个 *，仅暴露注册域
  if (keepFrom <= 0) return parts.join('.')
  return ['*', ...parts.slice(keepFrom)].join('.')
}

/**
 * 服务器地址脱敏展示：保留 http/https 前缀与端口，仅子域脱敏，注册域明文。
 * 例：https://movie.example.com:3000 → https://*.example.com:3000
 */
export function maskBaseUrl(input: string): string {
  const raw = (input || '').trim()
  if (!raw) return ''
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '***'
    const port = u.port ? `:${u.port}` : ''
    return `${u.protocol}//${maskHostname(u.hostname)}${port}`
  } catch {
    // 尽量保留协议提示
    const m = raw.match(/^(https?:\/\/)?([^/:?#]+)/i)
    if (!m) return '***'
    const scheme = (m[1] || 'https://').toLowerCase()
    return `${scheme}${maskHostname(m[2])}`
  }
}
