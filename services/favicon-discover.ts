// 站点 favicon 发现：不假设固定 /favicon.ico
// 顺序：本地缓存 → HTML <link rel=icon> → 常见静态路径 → 公共图标服务
// 扩展已有 <all_urls> host 权限，可在 background/popup 侧 fetch 目标站首页
import { STORAGE_KEYS, storageGet, storageSet } from '../core/storage'
import { extractRegistrableDomain, normalizeHost } from './site-icon-pack'

const CACHE_KEY = STORAGE_KEYS.SITE_FAVICON_CACHE
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 天
const HTML_FETCH_TIMEOUT_MS = 8000
const HTML_MAX_CHARS = 250_000

interface FaviconCacheEntry {
  url: string
  updatedAt: number
}

type FaviconCache = Record<string, FaviconCacheEntry>

/** 进程内缓存，避免列表页重复读 storage */
const memCache = new Map<string, string>()
/** 进程内 in-flight 去重 */
const inflight = new Map<string, Promise<string | null>>()
/** storage → 内存只 hydrate 一次，避免 N 域重复 storageGet */
let hydratePromise: Promise<void> | null = null

function isHttpUrl(v?: string | null): boolean {
  if (!v || typeof v !== 'string') return false
  return /^https?:\/\//i.test(v.trim())
}

/** 是否为公共图标服务地址（不宜作为首选/强缓存） */
export function isPublicFaviconService(url?: string | null): boolean {
  if (!url) return false
  return /favicon\.im\//i.test(url) || /google\.com\/s2\/favicons/i.test(url) || /favicon\.yandex\./i.test(url)
}

function absUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

function originOf(domainOrUrl: string): string | null {
  const raw = (domainOrUrl || '').trim()
  if (!raw) return null
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.origin
  } catch {
    return null
  }
}

async function loadCache(): Promise<FaviconCache> {
  return (await storageGet<FaviconCache>(CACHE_KEY)) || {}
}

async function saveCache(cache: FaviconCache): Promise<void> {
  await storageSet(CACHE_KEY, cache)
}

function acceptCachedUrl(url?: string | null): string | null {
  if (!url || !isHttpUrl(url)) return null
  // 公共服只作加载失败后的兜底，不作为首选缓存命中
  if (isPublicFaviconService(url)) return null
  return url
}

/** 一次性把 storage 缓存灌入 memCache */
export async function hydrateFaviconCache(): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const cache = await loadCache()
        const now = Date.now()
        for (const [host, hit] of Object.entries(cache || {})) {
          if (!host || !hit?.url) continue
          if (now - (hit.updatedAt || 0) > CACHE_TTL_MS) continue
          const url = acceptCachedUrl(hit.url)
          if (!url) continue
          memCache.set(host, url)
        }
      } catch {
        /* 持久化缓存读取失败时继续执行无缓存发现。 */
      }
    })()
  }
  await hydratePromise
}

function readMemFavicon(host: string): string | null {
  if (!host) return null
  const mem = memCache.get(host) || null
  if (mem && isPublicFaviconService(mem)) {
    memCache.delete(host)
    return null
  }
  return mem
}

export async function getCachedFavicon(domainOrUrl: string): Promise<string | null> {
  const host = normalizeHost(domainOrUrl)
  if (!host) return null
  const hit = readMemFavicon(host)
  if (hit) return hit
  await hydrateFaviconCache()
  return readMemFavicon(host)
}

/** 批量读缓存：只 hydrate 一次 storage，供列表页本地优先填充 */
export async function getCachedFaviconsBatch(
  domains: string[],
): Promise<Record<string, string>> {
  await hydrateFaviconCache()
  const out: Record<string, string> = {}
  for (const raw of domains) {
    const host = normalizeHost(raw)
    if (!host || out[host]) continue
    const hit = readMemFavicon(host)
    if (hit) out[host] = hit
  }
  return out
}

export async function setCachedFavicon(domainOrUrl: string, url: string): Promise<void> {
  const host = normalizeHost(domainOrUrl)
  if (!host || !isHttpUrl(url)) return
  memCache.set(host, url)
  // 保证后续 hydrate 不会覆盖本次写入：已 hydrate 则合并写；未 hydrate 则先灌再写
  try {
    await hydrateFaviconCache()
    const cache = await loadCache()
    cache[host] = { url, updatedAt: Date.now() }
    // 控制体积：最多 800 条，按时间淘汰
    const keys = Object.keys(cache)
    if (keys.length > 800) {
      const sorted = keys
        .map((k) => ({ k, t: cache[k]?.updatedAt || 0 }))
        .sort((a, b) => a.t - b.t)
      for (const { k } of sorted.slice(0, keys.length - 800)) delete cache[k]
    }
    await saveCache(cache)
  } catch {
    /* 持久化缓存写入失败不影响当前图标结果。 */
  }
}

/** 从 HTML 抽取 favicon / apple-touch-icon 链接（按质量排序） */
export function parseIconLinksFromHtml(html: string, baseUrl: string): string[] {
  if (!html || !baseUrl) return []
  const slice = html.length > HTML_MAX_CHARS ? html.slice(0, HTML_MAX_CHARS) : html
  const re =
    /<link\b[^>]*\brel\s*=\s*["']([^"']*)["'][^>]*>/gi
  const re2 =
    /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["']([^"']*)["'][^>]*>/gi

  type Cand = { href: string; score: number }
  const cands: Cand[] = []

  const pushLink = (relRaw: string, tag: string) => {
    const rel = (relRaw || '').toLowerCase()
    if (!/(^|\s)(icon|shortcut icon|apple-touch-icon|apple-touch-icon-precomposed)(\s|$)/i.test(rel)) {
      return
    }
    const hrefM = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)
    if (!hrefM?.[1]) return
    const abs = absUrl(hrefM[1].trim(), baseUrl)
    if (!abs || !isHttpUrl(abs)) return
    // data: 图标也可，但列表 <img> 支持；此处只收 http(s) 以降低体积问题
    // 列表头像优先标准 favicon；apple-touch 作备选
    let score = 0
    if (/\bshortcut\s+icon\b/i.test(rel) || /(^|\s)icon(\s|$)/i.test(rel)) score += 40
    if (rel.includes('apple-touch-icon')) score += 20
    const sizesM = tag.match(/\bsizes\s*=\s*["']([^"']+)["']/i)
    if (sizesM?.[1] && sizesM[1] !== 'any') {
      const m = sizesM[1].match(/(\d+)\s*x\s*(\d+)/i)
      if (m) score += Math.min(Number(m[1]) || 0, 128) / 32
    }
    const typeM = tag.match(/\btype\s*=\s*["']([^"']+)["']/i)
    const type = (typeM?.[1] || '').toLowerCase()
    if (type.includes('svg')) score += 6
    if (type.includes('png') || type.includes('webp')) score += 4
    if (type.includes('ico')) score += 2
    // 路径含 favicon（含 hashed assets/favicon-xxx.png）明显加分
    if (/favicon/i.test(abs)) score += 15
    cands.push({ href: abs, score })
  }

  let m: RegExpExecArray | null
  // rel 在前
  while ((m = re.exec(slice))) {
    pushLink(m[1], m[0])
  }
  // href 在前
  while ((m = re2.exec(slice))) {
    pushLink(m[2], m[0])
  }

  cands.sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of cands) {
    if (seen.has(c.href)) continue
    seen.add(c.href)
    out.push(c.href)
  }
  return out
}

/** 常见静态 favicon 候选（含 apex） */
export function staticFaviconCandidates(domainOrUrl: string): string[] {
  const host = normalizeHost(domainOrUrl)
  if (!host || !host.includes('.')) return []
  const list: string[] = []
  const pushHost = (h: string) => {
    list.push(
      `https://${h}/favicon.ico`,
      `https://${h}/favicon.png`,
      `https://${h}/favicon.svg`,
      `https://${h}/apple-touch-icon.png`,
      `https://${h}/apple-touch-icon-precomposed.png`,
    )
  }
  pushHost(host)
  const reg = extractRegistrableDomain(host)
  if (reg && reg !== host) pushHost(reg)
  return [...new Set(list)]
}

/** 公共图标服务兜底（返回可直接作 <img src> 的 URL） */
export function publicFaviconServiceUrl(domainOrUrl: string): string | null {
  const host = normalizeHost(domainOrUrl)
  if (!host || !host.includes('.')) return null
  // favicon.im：直接拼接完整主机名，无需 http(s) 前缀
  return `https://a.favicon.im/${host}`
}

async function fetchHtml(origin: string): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), HTML_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(origin + '/', {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      cache: 'force-cache',
      signal: ctrl.signal,
      headers: {
        // 只要 HTML，减小体积
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      },
    })
    if (!res.ok) return null
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (ct && !ct.includes('html') && !ct.includes('text/')) {
      // 部分站 content-type 不准，仍尝试读一小段
    }
    const text = await res.text()
    return text || null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 发现站点 favicon 最佳 URL（带缓存与 in-flight 去重）。
 * 顺序：缓存 → HTML &lt;link rel=icon&gt; → 站点 /favicon.ico 等静态路径。
 * 不在此处返回公共图标服务（避免多数可用 /favicon.ico 的站被错误优选 Google）。
 * 公共服仅由 UI @error 链作最后兜底。
 */
export async function discoverFaviconUrl(domainOrUrl: string): Promise<string | null> {
  const host = normalizeHost(domainOrUrl)
  if (!host || !host.includes('.')) return null

  const cached = await getCachedFavicon(host)
  if (cached) return cached

  const existing = inflight.get(host)
  if (existing) return existing

  const task = (async () => {
    try {
      const origin = originOf(domainOrUrl) || `https://${host}`
      const statics = staticFaviconCandidates(host)
      const defaultIco = statics[0] || `https://${host}/favicon.ico`

      // 1) 解析首页 <link rel="icon" …>（hashed 路径如 /assets/favicon-xxx.png）
      const html = await fetchHtml(origin)
      if (html) {
        const links = parseIconLinksFromHtml(html, origin + '/')
        if (links.length) {
          // 页面声明默认 ico/png 时使用静态候选，否则使用页面提供的实际路径。
          await setCachedFavicon(host, links[0])
          return links[0]
        }
      }

      // 2) 标准静态路径：优先 /favicon.ico（多数站如此，无需公共服）
      await setCachedFavicon(host, defaultIco)
      return defaultIco
    } finally {
      inflight.delete(host)
    }
  })()

  inflight.set(host, task)
  return task
}

/**
 * 批量发现（限流），返回 host → url
 */
export async function discoverFaviconsBatch(
  domains: string[],
  concurrency = 4,
): Promise<Record<string, string>> {
  const hosts = [
    ...new Set(
      domains.map((d) => normalizeHost(d)).filter((h) => !!h && h.includes('.')),
    ),
  ]
  const out: Record<string, string> = {}
  let i = 0
  async function worker(): Promise<void> {
    while (i < hosts.length) {
      const idx = i++
      const host = hosts[idx]
      try {
        const url = await discoverFaviconUrl(host)
        if (url) out[host] = url
      } catch {
        /* 单个域名发现失败时继续处理其余域名。 */
      }
    }
  }
  const n = Math.max(1, Math.min(concurrency, hosts.length || 1))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return out
}

/**
 * 供 UI 加载失败时切换的候选链。
 * 顺序：其它静态路径 → 公共图标服务（最后兜底）。
 */
export function faviconFallbackChain(domainOrUrl: string, failedUrl?: string): string[] {
  const host = normalizeHost(domainOrUrl)
  if (!host) return []
  const list: string[] = []
  list.push(...staticFaviconCandidates(host))
  const pub = publicFaviconServiceUrl(host)
  if (pub) list.push(pub)
  const uniq = [...new Set(list.filter(isHttpUrl))]
  if (!failedUrl) return uniq
  return uniq.filter((u) => u !== failedUrl)
}
