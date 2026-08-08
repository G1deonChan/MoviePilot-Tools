// 凭据名称 / 分组推断：匹配 MP supporting 与已配置站点
// - PT：分组 pt，名称用站点官方名
// - 非 PT：分组 custom，名称优先用浏览器标签页标题
import type { CredentialCategory, Site, SiteSupportingInfo } from '../core/types'
import { isPrivateHost } from '../utils/url'
import { loadStoredSites } from './site-manage'
import {
  buildDomainAliasIndex,
  fetchSupportingDomains,
  findSiteIdsByDomain,
  loadCustomDomainAliases,
  normalizeDomain,
} from './site-domain-alias'
import {
  loadSupportingForIcons,
  matchSupportingDomain,
} from './site-icon'
import { normalizeHost } from './site-icon-pack'

export type CredCategory = CredentialCategory

export interface CredentialSiteFill {
  category: CredCategory
  /** 建议展示/保存名称 */
  name: string
  /** 是否命中 PT supporting 或已配置站 */
  isPt: boolean
  /** supporting key 或站点 domain */
  matchedKey?: string
}

/** 清理标签页标题：去掉常见浏览器后缀与过长空白 */
export function sanitizeTabTitle(title?: string | null): string {
  let t = (title || '').trim()
  if (!t) return ''
  // 常见分隔： "Login - Site" / "Site | xxx" 保留全文，仅压空白
  t = t.replace(/\s+/g, ' ').trim()
  // 过长截断，避免异常标题
  if (t.length > 80) t = `${t.slice(0, 77)}...`
  return t
}

function hostOf(domainOrUrl: string): string {
  return normalizeHost(domainOrUrl || '')
}

export function createCredentialSiteBatchResolver(): (
  inputs: Array<{ domain: string; name: string }>,
) => Promise<CredentialSiteFill[]> {
  return async (inputs) => {
    const [supportingResult, aliasesResult, sitesResult] = await Promise.allSettled([
      fetchSupportingDomains(),
      loadCustomDomainAliases(),
      loadStoredSites(),
    ])
    const supporting: Record<string, SiteSupportingInfo> =
      supportingResult.status === 'fulfilled' ? supportingResult.value : {}
    const aliases = aliasesResult.status === 'fulfilled' ? aliasesResult.value : []
    const sites = sitesResult.status === 'fulfilled' ? sitesResult.value : []
    const aliasIndex = buildDomainAliasIndex(supporting, aliases)

    return inputs.map(({ domain, name }) => {
      const host = hostOf(domain)
      const fallbackName = sanitizeTabTitle(name) || host || domain || '未知站点'
      if (!host) return { category: 'custom', name: fallbackName, isPt: false }
      if (isPrivateHost(host)) return { category: 'intranet', name: fallbackName, isPt: false }

      const siteIds = findSiteIdsByDomain(aliasIndex, host)
      if (siteIds.length === 1) {
        const siteId = siteIds[0]
        const matched = Object.values(supporting).find((site) => String(site.id) === siteId)
        return {
          category: 'pt',
          name: (matched?.name || '').trim() || host,
          isPt: true,
          matchedKey: normalizeDomain(matched?.url || matched?.domain || host),
        }
      }

      const configured = sites.find((site) => {
        const siteHost = hostOf(site.domain || site.url || '')
        return Boolean(
          siteHost &&
            (host === siteHost || host.endsWith(`.${siteHost}`) || siteHost.endsWith(`.${host}`)),
        )
      })
      if (configured) {
        return {
          category: 'pt',
          name: (configured.name || '').trim() || host,
          isPt: true,
          matchedKey: configured.domain || host,
        }
      }
      return { category: 'custom', name: fallbackName, isPt: false }
    })
  }
}

/**
 * 根据域名推断凭据名称与分组。
 * @param domainOrUrl 域名或完整 URL
 * @param tabTitle 非 PT 时使用的选项卡标题
 */
export async function resolveCredentialSiteFill(
  domainOrUrl: string,
  tabTitle?: string | null,
): Promise<CredentialSiteFill> {
  const host = hostOf(domainOrUrl)
  const fallbackHost = host || (domainOrUrl || '').trim() || '未知站点'
  const title = sanitizeTabTitle(tabTitle)

  if (!host) {
    return {
      category: 'custom',
      name: title || fallbackHost,
      isPt: false,
    }
  }
  if (isPrivateHost(host)) {
    return {
      category: 'intranet',
      name: title || host,
      isPt: false,
    }
  }

  // 1) MP supporting 目录与用户备用域名，按稳定站点 ID 聚合。
  try {
    const [supporting, customAliases] = await Promise.all([
      fetchSupportingDomains(),
      loadCustomDomainAliases(),
    ])
    const index = buildDomainAliasIndex(supporting, customAliases)
    const siteIds = findSiteIdsByDomain(index, host)
    if (siteIds.length === 1) {
      const siteId = siteIds[0]
      const matched = Object.values(supporting).find((site) => String(site.id) === siteId)
      return {
        category: 'pt',
        name: (matched?.name || '').trim() || host,
        isPt: true,
        matchedKey: normalizeDomain(matched?.url || matched?.domain || host),
      }
    }
  } catch {
    /* Supporting 与备用域名读取失败时继续尝试图标用途的进程缓存。 */
  }

  // 图标用途的 Supporting 进程缓存可在网络不可用时继续参与站点识别。
  try {
    const supporting = await loadSupportingForIcons()
    const key = matchSupportingDomain(host, supporting)
    if (key) {
      return { category: 'pt', name: (supporting[key]?.name || '').trim() || key, isPt: true, matchedKey: key }
    }
  } catch {
    /* 图标用途的 Supporting 缓存读取失败时继续匹配已配置站点缓存。 */
  }

  // 2) 用户已配置站点缓存（名称可能更贴近个人习惯）
  try {
    const sites = await loadStoredSites()

    let best: Site | null = null
    for (const s of sites) {
      const sd = hostOf(s.domain || s.url || '')
      if (!sd) continue
      if (host === sd || host.endsWith(`.${sd}`) || sd.endsWith(`.${host}`)) {
        best = s
        break
      }
    }
    if (best) {
      const official = (best.name || '').trim()
      return {
        category: 'pt',
        name: official || hostOf(best.domain) || host,
        isPt: true,
        matchedKey: best.domain || host,
      }
    }
  } catch {
    /* 已配置站点缓存读取失败时按非 PT 站点返回。 */
  }

  // 3) 非 PT：自定义分组 + 标签页标题
  return {
    category: 'custom',
    name: title || fallbackHost,
    isPt: false,
  }
}
