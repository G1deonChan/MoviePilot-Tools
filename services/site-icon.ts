// 站点图标统一解析：
// 用户图标包（supporting 辅助）> 站点自带 icon > MP API > favicon 发现（HTML link / 缓存 / 公共服务）
// 最终字母头像由 UI 在无图 / 图片加载失败时展示
import { fetchSiteIconById } from './site-stat'
import type { SupportingDict } from './site-manage'
import { fetchSupportingSites } from './site-supporting'
import {
  ensureIconPackReady,
  getLocalIconFromPack,
  getLocalIconFromPackSync,
  normalizeHost,
  extractRegistrableDomain,
  type IconMatchHints,
} from './site-icon-pack'
import {
  discoverFaviconUrl,
  discoverFaviconsBatch,
  getCachedFaviconsBatch,
  staticFaviconCandidates,
} from './favicon-discover'

function isIconUrl(v?: string | null): boolean {
  if (!v || typeof v !== 'string') return false
  return (
    v.startsWith('data:') ||
    v.startsWith('http://') ||
    v.startsWith('https://') ||
    v.startsWith('chrome-extension://') ||
    v.startsWith('blob:')
  )
}

/** 返回站点 favicon 默认路径；页面声明的实际路径请使用 `discoverFaviconUrl`。 */
export function siteFaviconUrl(domainOrUrl: string): string | null {
  const host = normalizeHost(domainOrUrl)
  if (!host || !host.includes('.')) return null
  // 优先完整 host；多数站 favicon 挂在 apex 亦可再试注册域
  return `https://${host}/favicon.ico`
}

/** 静态路径候选：ico/png/svg/apple-touch + apex */
export function siteFaviconCandidates(domainOrUrl: string): string[] {
  return staticFaviconCandidates(domainOrUrl)
}

export type SiteIconInput = {
  domain: string
  id?: number
  icon?: string | null
  name?: string | null
  url?: string | null
}

/** supporting 域名缓存（进程内） */
let supportingCache: SupportingDict | null = null
let supportingPromise: Promise<SupportingDict> | null = null

export async function loadSupportingForIcons(
  force = false,
): Promise<SupportingDict> {
  if (!force && supportingCache) return supportingCache
  if (!force && supportingPromise) return supportingPromise
  supportingPromise = fetchSupportingSites(force)
    .then((data) => {
      supportingCache = data || {}
      return supportingCache
    })
    .catch(() => {
      supportingCache = supportingCache || {}
      return supportingCache
    })
    .finally(() => {
      supportingPromise = null
    })
  return supportingPromise
}

/**
 * 用 supporting 的 key（如 0ff.cc）匹配当前 host（pt.0ff.cc / 0ff.cc）
 */
export function matchSupportingDomain(
  domain: string,
  supporting: SupportingDict,
): string | null {
  const host = normalizeHost(domain)
  if (!host || !supporting) return null
  const keys = Object.keys(supporting)
  if (!keys.length) return null

  const lowerMap = new Map(keys.map((k) => [normalizeHost(k), k]))
  if (lowerMap.has(host)) return lowerMap.get(host)!

  // 子域：pt.0ff.cc 匹配 0ff.cc
  const parts = host.split('.')
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.')
    if (lowerMap.has(parent)) return lowerMap.get(parent)!
  }

  // 注册域回退
  const reg = extractRegistrableDomain(host)
  if (reg && lowerMap.has(reg)) return lowerMap.get(reg)!

  // 末两段 / 末三段包含匹配（supporting key 可能是完整 host）
  for (const [nk, original] of lowerMap) {
    if (!nk.includes('.')) continue
    if (host === nk || host.endsWith(`.${nk}`) || nk.endsWith(`.${host}`)) return original
  }
  return null
}

function buildHints(
  site: SiteIconInput,
  supporting: SupportingDict,
): IconMatchHints {
  const domain = site.domain || normalizeHost(site.url || '')
  const supportKey = matchSupportingDomain(domain, supporting)
  const supportInfo = supportKey ? supporting[supportKey] : undefined
  return {
    supportingDomain: supportKey || undefined,
    name: site.name || supportInfo?.name || undefined,
    url: site.url || undefined,
  }
}

function assignIcon(
  out: Record<string, string>,
  domain: string,
  icon: string,
  alias?: string,
): void {
  out[domain] = icon
  if (alias) out[alias] = icon
}

/**
 * 解析单个站点图标
 * 优先级：图标包 > 站点 icon > API > favicon 发现（缓存 / HTML link / 公共服务）
 * 无结果时返回 null，由 UI 展示字母 logo
 */
export async function resolveSiteIcon(
  domain: string,
  opts: {
    siteIcon?: string | null
    siteId?: number | null
    name?: string | null
    url?: string | null
    allowApi?: boolean
    allowFavicon?: boolean
  } = {},
): Promise<string | null> {
  if (!domain && !opts.url) return null
  await ensureIconPackReady()
  const supporting = await loadSupportingForIcons()
  const host = normalizeHost(domain || opts.url || '')
  const hints = buildHints(
    { domain: host, name: opts.name, url: opts.url },
    supporting,
  )

  const pack = getLocalIconFromPackSync(host, hints)
  if (pack) return pack

  if (isIconUrl(opts.siteIcon)) return opts.siteIcon as string

  if (opts.allowApi !== false && opts.siteId && opts.siteId > 0) {
    try {
      const apiIcon = await fetchSiteIconById(opts.siteId)
      if (isIconUrl(apiIcon)) return apiIcon
    } catch {
      /* MP 图标 API 失败后继续执行 favicon 发现。 */
    }
  }

  if (opts.allowFavicon !== false) {
    try {
      const discovered = await discoverFaviconUrl(host || opts.url || domain)
      if (isIconUrl(discovered)) return discovered
    } catch {
      /* favicon 发现失败后使用站点自身的 `/favicon.ico`。 */
    }
    // 发现失败：优先站点自身 /favicon.ico，公共服仅 UI 失败链使用
    return siteFaviconUrl(host || opts.url || domain)
  }
  return null
}

export type ResolveSiteIconsBatchOptions = {
  allowApi?: boolean
  allowFavicon?: boolean
  batchSize?: number
  useSupporting?: boolean
  /**
   * 网络发现并发（默认 4）。
   * 凭据列表可略降以减少同时打开大量站点首页。
   */
  discoverConcurrency?: number
  /**
   * 本地阶段（图标包 / 站点 icon / 缓存 / 默认 ico）完成后立即回调。
   * 网络发现结束后再回调一次，便于列表渐进填充。
   */
  onUpdate?: (map: Record<string, string>) => void
  /**
   * true：本地阶段完成后立即 resolve，网络发现在后台继续并通过 onUpdate 推送。
   * 默认 false，保持旧语义（等发现结束再返回）。
   */
  deferNetworkDiscover?: boolean
}

/** 批量解析：图标包 > 站点 icon > API > favicon 发现 */
export async function resolveSiteIconsBatch(
  sites: SiteIconInput[],
  options: ResolveSiteIconsBatchOptions = {},
): Promise<Record<string, string>> {
  await ensureIconPackReady()
  const allowApi = options.allowApi !== false
  const allowFavicon = options.allowFavicon !== false
  const useSupporting = options.useSupporting !== false
  const batchSize = options.batchSize ?? 10
  const discoverConcurrency = options.discoverConcurrency ?? 4
  const onUpdate = options.onUpdate
  const deferNetworkDiscover = options.deferNetworkDiscover === true

  // supporting 仅辅助图标包匹配：优先用进程缓存，避免列表首屏被 API 卡住
  let supporting: SupportingDict =
    useSupporting && supportingCache ? supportingCache : {}
  const out: Record<string, string> = {}
  const needApi: Array<{ domain: string; id: number; alias?: string; site: SiteIconInput }> = []
  let unresolved: Array<{ domain: string; alias?: string; site: SiteIconInput }> = []

  const tryPack = (site: SiteIconInput, domain: string, alias?: string): boolean => {
    const hints = buildHints({ ...site, domain }, supporting)
    const pack = getLocalIconFromPackSync(domain, hints)
    if (!pack) return false
    assignIcon(out, domain, pack, alias)
    return true
  }

  // 先批量 hydrate favicon 缓存（单次 storage 读）
  const hostList = sites
    .map((s) => normalizeHost(s.domain || s.url || ''))
    .filter((d) => d && d.includes('.'))
  const favCache = allowFavicon
    ? await getCachedFaviconsBatch(hostList)
    : ({} as Record<string, string>)

  for (const s of sites) {
    const domain = normalizeHost(s.domain || s.url || '')
    if (!domain || !domain.includes('.')) continue
    const alias = s.domain && s.domain !== domain ? s.domain : undefined
    if (tryPack(s, domain, alias)) continue
    if (isIconUrl(s.icon)) {
      assignIcon(out, domain, s.icon as string, alias)
      continue
    }
    const cached = favCache[domain]
    if (cached && isIconUrl(cached)) {
      assignIcon(out, domain, cached, alias)
      continue
    }
    if (allowApi && s.id && s.id > 0 && domain !== 'fsm.name') {
      needApi.push({ domain, id: s.id, alias, site: s })
    } else {
      unresolved.push({ domain, alias, site: s })
    }
  }

  // supporting 辅助图标包：渐进模式不阻塞首屏；同步模式仍等待
  // force=true 时即使已有默认 ico 也会用图标包覆盖
  const rematchWithSupporting = async (
    items: typeof unresolved,
    force = false,
  ): Promise<typeof unresolved> => {
    if (!useSupporting || !items.length) return items
    try {
      supporting = await loadSupportingForIcons()
      const still: typeof unresolved = []
      for (const item of items) {
        if (!force && out[item.domain]) {
          still.push(item)
          continue
        }
        // force：允许图标包覆盖默认 favicon
        if (tryPack(item.site, item.domain, item.alias)) continue
        still.push(item)
      }
      return still
    } catch {
      return items
    }
  }

  if (!deferNetworkDiscover) {
    unresolved = await rematchWithSupporting(unresolved, false)
  }

  for (let i = 0; i < needApi.length; i += batchSize) {
    const batch = needApi.slice(i, i + batchSize)
    await Promise.all(
      batch.map(async ({ domain, id, alias, site }) => {
        try {
          const icon = await fetchSiteIconById(id)
          if (isIconUrl(icon)) {
            assignIcon(out, domain, icon as string, alias)
            return
          }
        } catch {
          /* 单个 MP 图标 API 失败时将该站点交给 favicon 发现。 */
        }
        unresolved.push({ domain, alias, site })
      }),
    )
    if (i + batchSize < needApi.length) {
      await new Promise((r) => setTimeout(r, 80))
    }
  }

  // 本地阶段结束：未解析的先填默认 /favicon.ico，列表可立即展示
  const seedDefaultFavicons = (
    items: Array<{ domain: string; alias?: string }>,
  ): Array<{ domain: string; alias?: string }> => {
    if (!allowFavicon) return []
    const needDiscover: Array<{ domain: string; alias?: string }> = []
    for (const { domain, alias } of items) {
      // 已有非默认图标（图标包/缓存/站点 icon）则跳过
      if (out[domain] && !/\/favicon\.ico(?:\?|$)/i.test(out[domain])) continue
      const fav = siteFaviconUrl(domain)
      if (!fav) continue
      if (!out[domain]) assignIcon(out, domain, fav, alias)
      needDiscover.push({ domain, alias })
    }
    return needDiscover
  }

  let needDiscover = seedDefaultFavicons(unresolved)
  onUpdate?.({ ...out })

  const runDiscover = async (): Promise<void> => {
    // 渐进模式：先用 supporting 重匹配图标包（可覆盖默认 ico），再对剩余项发现
    if (deferNetworkDiscover) {
      const before = { ...out }
      const still = await rematchWithSupporting(unresolved, true)
      needDiscover = seedDefaultFavicons(still)
      const rematched = still.length !== unresolved.length
        || Object.keys(out).some((k) => out[k] !== before[k])
      if (rematched) onUpdate?.({ ...out })
    }

    // 仅对仍停留在默认/未更好解析的域名做网络发现
    needDiscover = needDiscover.filter(({ domain }) => {
      const cur = out[domain]
      return !cur || /\/favicon\.ico(?:\?|$)/i.test(cur) || isPublicFaviconServiceLike(cur)
    })

    if (!allowFavicon || !needDiscover.length) return
    try {
      const found = await discoverFaviconsBatch(
        needDiscover.map((x) => x.domain),
        discoverConcurrency,
      )
      let changed = false
      for (const { domain, alias } of needDiscover) {
        const better = found[domain]
        if (!isIconUrl(better) || better === out[domain]) continue
        // 若后台已命中图标包，勿用发现结果覆盖
        if (getLocalIconFromPackSync(domain, buildHints({ domain }, supporting))) continue
        assignIcon(out, domain, better as string, alias)
        changed = true
      }
      if (changed) onUpdate?.({ ...out })
    } catch {
      /* 保持默认 /favicon.ico */
    }
  }

  if (deferNetworkDiscover) {
    void runDiscover()
    return { ...out }
  }

  await runDiscover()
  return out
}

function isPublicFaviconServiceLike(url?: string | null): boolean {
  if (!url) return false
  return /favicon\.im\//i.test(url) || /google\.com\/s2\/favicons/i.test(url) || /favicon\.yandex\./i.test(url)
}

export {
  getLocalIconFromPack,
  ensureIconPackReady,
  isIconUrl,
  normalizeHost,
  type IconMatchHints,
}
