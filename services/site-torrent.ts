import type { AddTorrentIn, Site, SiteDomainAlias, SiteSupportingInfo } from '../core/types'
import { domainsMatch, normalizeDomain } from './site-domain-alias'

function hostOf(value: string): string {
  try {
    return new URL(value).hostname
  } catch {
    return normalizeDomain(value)
  }
}

function supportingIdentity(
  host: string,
  supporting: Record<string, SiteSupportingInfo>,
): SiteSupportingInfo | undefined {
  return Object.values(supporting).find((item) =>
    domainsMatch(host, item.domain || item.url || ''),
  )
}

export function findConfiguredSiteForUrl(
  pageUrl: string,
  sites: Site[],
  supporting: Record<string, SiteSupportingInfo>,
  aliases: SiteDomainAlias[],
): Site | undefined {
  const host = hostOf(pageUrl)
  if (!host) return undefined

  const direct = sites.find((site) =>
    [site.domain, site.url || ''].some((value) => value && domainsMatch(host, value)),
  )
  if (direct) return direct

  const alias = aliases.find((item) => domainsMatch(host, item.domain))
  if (alias) {
    const matched = sites.find((site) => String(site.id) === String(alias.siteId))
    if (matched) return matched
  }

  const target = supportingIdentity(host, supporting)
  if (!target) return undefined
  const targetId = target.id == null ? '' : String(target.id)
  const targetName = target.name?.trim().toLowerCase() || ''
  return sites.find((site) => {
    const identity = supportingIdentity(site.domain || site.url || '', supporting)
    if (!identity) return false
    if (targetId && identity.id != null && String(identity.id) === targetId) return true
    return Boolean(
      targetName && identity.name?.trim().toLowerCase() === targetName,
    )
  })
}

function comparableUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    const entries = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))
    url.search = ''
    for (const [key, val] of entries) url.searchParams.append(key, val)
    return url.toString().replace(/\/$/, '')
  } catch {
    return value.trim().replace(/\/$/, '')
  }
}

function resourceIds(value: string): Set<string> {
  const ids = new Set<string>()
  try {
    const url = new URL(value)
    for (const key of ['id', 'tid', 'torrentid']) {
      const id = url.searchParams.get(key)?.trim()
      if (id) ids.add(id)
    }
    const pathMatch = url.pathname.match(/(?:torrent|detail|details)[/-](\d+)/i)
    if (pathMatch?.[1]) ids.add(pathMatch[1])
  } catch {
    // 非标准 URL 只参与完整地址比较。
  }
  return ids
}

export function findTorrentForPage(
  pageUrl: string,
  resources: AddTorrentIn[],
): AddTorrentIn | undefined {
  const targetUrl = comparableUrl(pageUrl)
  const targetIds = resourceIds(pageUrl)

  return resources.find((torrent) => {
    const candidates = [torrent.page_url || '', torrent.enclosure || ''].filter(Boolean)
    if (candidates.some((value) => comparableUrl(value) === targetUrl)) return true
    if (!targetIds.size) return false
    return candidates.some((value) => {
      const ids = resourceIds(value)
      return [...targetIds].some((id) => ids.has(id))
    })
  })
}

export function buildSiteTorrent(
  torrent: AddTorrentIn,
  site: Site,
  pageUrl: string,
  fallbackTitle = '',
): AddTorrentIn {
  return {
    ...torrent,
    title: torrent.title?.trim() || fallbackTitle.trim() || '未知种子',
    description: torrent.description || '',
    enclosure: torrent.enclosure,
    page_url: torrent.page_url || pageUrl,
    site: torrent.site ?? site.id,
    site_name: torrent.site_name || site.name,
    site_cookie: torrent.site_cookie || site.cookie,
    site_ua: torrent.site_ua || site.ua,
    site_proxy: torrent.site_proxy ?? Boolean(site.is_proxy),
    site_order: torrent.site_order ?? site.pri,
    site_downloader: torrent.site_downloader || site.downloader,
  }
}
