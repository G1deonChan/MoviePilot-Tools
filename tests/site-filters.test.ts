import { describe, expect, it } from 'vitest'
import type { SiteFilterKey } from '../core/storage-contracts'
import { STORED_SITE_FILTER_DEFAULTS } from '../core/storage-policy'
import {
  DEFAULT_SITE_FILTERS,
  applySiteFilters,
  buildConfiguredKeySet,
  buildSiteRows,
  evalSiteFlags,
  migrateSiteFilters,
  supportingKeySet,
} from '../services/site-manage'
import {
  buildBrowserCookieMap,
  cookieDomainMatchesHost,
  hasConfiguredCookieNameMatch,
  hasValidBrowserSession,
  isAuthCookieName,
  isNoiseCookieName,
  siteKeyOf,
} from '../utils/cookie'
import type { Site } from '../core/types'

function fakeSite(partial: Partial<Site> & { id: number; domain: string }): Site {
  return {
    name: partial.name || partial.domain,
    url: partial.url || `https://${partial.domain}`,
    icon: '',
    pri: 0,
    timeout: 30,
    downloader: '',
    cookie: '',
    ua: '',
    is_active: true,
    is_limited: false,
    is_proxy: false,
    is_browser_simulated: false,
    lst_state: 'unknown',
    ...partial,
  }
}

describe('站点筛选契约', () => {
  it('页面默认值与持久化策略默认值保持独立语义', () => {
    const pageDefaults: Record<SiteFilterKey, boolean> = DEFAULT_SITE_FILTERS
    expect(pageDefaults).toEqual({
      browser: false,
      server: false,
      cookieDiff: true,
      uaDiff: true,
      notLoggedIn: true,
      notAdded: false,
      notOwned: false,
    })
    expect(STORED_SITE_FILTER_DEFAULTS).toEqual({
      browser: true,
      server: true,
      cookieDiff: false,
      uaDiff: false,
      notLoggedIn: false,
      notAdded: false,
      notOwned: false,
    })
  })
})

describe('cookie session helpers', () => {
  it('siteKey 去 www / 端口', () => {
    expect(siteKeyOf('https://www.Example.com:443/path')).toBe('example.com')
    expect(siteKeyOf('WWW.pt.com')).toBe('pt.com')
  })

  it('噪声 Cookie 不算鉴权', () => {
    expect(isNoiseCookieName('cf_clearance')).toBe(true)
    expect(isNoiseCookieName('__cf_bm')).toBe(true)
    expect(isAuthCookieName('cf_clearance')).toBe(false)
    expect(isAuthCookieName('uid')).toBe(true)
    expect(isAuthCookieName('c_secure_uid')).toBe(true)
    expect(hasValidBrowserSession('cf_clearance=x; __cf_bm=y')).toBe(false)
    expect(hasValidBrowserSession('uid=1; pass=2')).toBe(true)
  })

  it('自定义 Cookie 名与 MP 配置同名时算有效会话', () => {
    expect(hasConfiguredCookieNameMatch('zq_custom_hash=old', 'zq_custom_hash=new')).toBe(true)
    expect(hasConfiguredCookieNameMatch('cf_clearance=old', 'cf_clearance=new')).toBe(false)
    expect(hasConfiguredCookieNameMatch('site_pref=1', 'other=1')).toBe(false)
  })

  it('父域 Cookie 覆盖子域 host', () => {
    expect(cookieDomainMatchesHost('.example.com', 'www.example.com')).toBe(true)
    expect(cookieDomainMatchesHost('example.com', 'tracker.example.com')).toBe(true)
    expect(cookieDomainMatchesHost('tracker.example.com', 'example.com')).toBe(false)
  })
})

describe('evalSiteFlags', () => {
  it('已配置 + 无会话 → 未登录，且不标 CK/UA 差异', () => {
    const f = evalSiteFlags({
      inConfigured: true,
      supported: true,
      isApi: false,
      hasAuthSession: false,
      serverCookie: 'uid=1',
      serverUA: 'ServerUA',
      browserCookie: '',
      browserUA: 'BrowserUA',
    })
    expect(f.server).toBe(true)
    expect(f.notLoggedIn).toBe(true)
    expect(f.browser).toBe(false)
    expect(f.notOwned).toBe(false)
    expect(f.cookieDiff).toBe(false)
    expect(f.uaDiff).toBe(false)
  })

  it('已配置 + 有会话 + Cookie/UA 不同 → CK/UA 差异', () => {
    const f = evalSiteFlags({
      inConfigured: true,
      supported: true,
      isApi: false,
      hasAuthSession: true,
      serverCookie: 'uid=1',
      serverUA: 'ServerUA',
      browserCookie: 'uid=2',
      browserUA: 'BrowserUA',
    })
    expect(f.notLoggedIn).toBe(false)
    expect(f.cookieDiff).toBe(true)
    expect(f.uaDiff).toBe(true)
  })

  it('API 站不做 CK 差异 / 未登录', () => {
    const f = evalSiteFlags({
      inConfigured: true,
      supported: true,
      isApi: true,
      hasAuthSession: false,
      serverCookie: 'uid=1',
      browserCookie: '',
    })
    expect(f.cookieDiff).toBe(false)
    expect(f.notLoggedIn).toBe(false)
  })

  it('S−C 有鉴权会话 → 未添加 ⊂ 未拥有', () => {
    const f = evalSiteFlags({
      inConfigured: false,
      supported: true,
      isApi: false,
      hasAuthSession: true,
    })
    expect(f.notOwned).toBe(true)
    expect(f.notAdded).toBe(true)
    expect(f.browser).toBe(true)
    expect(f.server).toBe(false)
  })

  it('S−C 无会话 → 仅未拥有', () => {
    const f = evalSiteFlags({
      inConfigured: false,
      supported: true,
      isApi: false,
      hasAuthSession: false,
    })
    expect(f.notOwned).toBe(true)
    expect(f.notAdded).toBe(false)
    expect(f.browser).toBe(false)
  })
})

describe('buildSiteRows + filters', () => {
  const supporting = {
    'alpha.pt': { name: 'Alpha' },
    'beta.pt': { name: 'Beta' },
    'gamma.pt': { name: 'Gamma' },
  }

  it('supportingKeySet / configuredKeySet', () => {
    expect([...supportingKeySet(supporting)].sort()).toEqual(['alpha.pt', 'beta.pt', 'gamma.pt'])
    const conf = buildConfiguredKeySet([
      fakeSite({ id: 1, domain: 'alpha.pt', url: 'https://www.alpha.pt' }),
    ])
    expect(conf.has('alpha.pt')).toBe(true)
    expect(conf.has('www.alpha.pt')).toBe(true)
  })

  it('L1：默认含已配置+未添加，未拥有懒展开', () => {
    const map = buildBrowserCookieMap([
      { domain: '.beta.pt', name: 'uid', value: '1' },
      { domain: '.beta.pt', name: 'pass', value: 'x' },
      { domain: 'gamma.pt', name: 'cf_clearance', value: 'noise' },
    ])
    const configured = [
      fakeSite({
        id: 1,
        domain: 'alpha.pt',
        cookie: 'uid=old',
        ua: 'server-ua',
      }),
    ]
    const rows0 = buildSiteRows({
      configured,
      supporting,
      browserMap: map,
      browserUA: 'browser-ua',
      expandNotOwned: false,
    })
    // 1 configured + beta 未添加；gamma 仅噪声 Cookie 不进未添加
    expect(rows0.some((r) => r.kind === 'configured' && r.site?.id === 1)).toBe(true)
    expect(rows0.some((r) => r.flags.notAdded && r.supporting?.domain === 'beta.pt')).toBe(true)
    expect(rows0.some((r) => r.supporting?.domain === 'gamma.pt')).toBe(false)

    const rows1 = buildSiteRows({
      configured,
      supporting,
      browserMap: map,
      expandNotOwned: true,
    })
    expect(rows1.some((r) => r.flags.notOwned && r.supporting?.domain === 'gamma.pt')).toBe(true)
    // beta 仍是 notAdded
    const beta = rows1.find((r) => r.supporting?.domain === 'beta.pt')
    expect(beta?.flags.notAdded).toBe(true)
    expect(beta?.flags.notOwned).toBe(true)
  })

  it('七筛 OR + 迁移 noSite', () => {
    const map = buildBrowserCookieMap([
      { domain: 'beta.pt', name: 'uid', value: '1' },
    ])
    const rows = buildSiteRows({
      configured: [fakeSite({ id: 1, domain: 'alpha.pt', cookie: 'uid=1' })],
      supporting,
      browserMap: map,
      expandNotOwned: true,
    })
    const onlyNotOwned = applySiteFilters(rows, {
      browser: false,
      server: false,
      cookieDiff: false,
      uaDiff: false,
      notLoggedIn: false,
      notAdded: false,
      notOwned: true,
    })
    expect(onlyNotOwned.every((r) => r.flags.notOwned)).toBe(true)

    expect(migrateSiteFilters(['noSite']).notOwned).toBe(true)
    expect(migrateSiteFilters({ noSite: true }).notOwned).toBe(true)
    expect(migrateSiteFilters({ notOwned: false, noSite: true }).notOwned).toBe(false)
  })

  it('子域鉴权 Cookie → 归入 supporting 父域，判为未添加', () => {
    const map = buildBrowserCookieMap([
      { domain: 'www.beta.pt', name: 'uid', value: '1' },
      { domain: 'www.beta.pt', name: 'pass', value: 'x' },
    ])
    const rows = buildSiteRows({
      configured: [fakeSite({ id: 1, domain: 'alpha.pt' })],
      supporting,
      browserMap: map,
      expandNotOwned: false,
    })
    const beta = rows.find((r) => r.supporting?.domain === 'beta.pt')
    expect(beta?.flags.notAdded).toBe(true)
    expect(beta?.flags.notOwned).toBe(true)
    expect(beta?.hasAuthSession).toBe(true)
  })

  it('已配置站自定义 Cookie 名与浏览器同名时不判未登录', () => {
    const rows = buildSiteRows({
      configured: [
        fakeSite({
          id: 1,
          domain: 'zq.example-pt.test',
          cookie: 'zq_custom_hash=server-value',
        }),
      ],
      supporting: { 'zq.example-pt.test': { name: '示例站' } },
      browserMap: buildBrowserCookieMap([
        { domain: '.zq.example-pt.test', name: 'zq_custom_hash', value: 'browser-value' },
        { domain: '.zq.example-pt.test', name: 'cf_clearance', value: 'noise' },
      ]),
    })
    const row = rows.find((item) => item.site?.id === 1)
    expect(row?.hasAuthSession).toBe(true)
    expect(row?.flags.browser).toBe(true)
    expect(row?.flags.notLoggedIn).toBe(false)
    expect(row?.flags.cookieDiff).toBe(true)
  })

  it('已配置 domain 与 supporting 不一致时，用 id/name 覆盖，不进 S−C', () => {
    const map = buildBrowserCookieMap([
      { domain: 'legacy.beta.pt', name: 'uid', value: '1' },
    ])
    const rows = buildSiteRows({
      configured: [
        fakeSite({
          id: 99,
          domain: 'legacy.beta.pt',
          name: 'Beta',
          url: 'https://legacy.beta.pt',
        }),
      ],
      supporting: {
        'beta.pt': { id: 99, name: 'Beta', url: 'https://beta.pt' },
        'gamma.pt': { name: 'Gamma' },
      },
      browserMap: map,
      expandNotOwned: true,
    })
    expect(rows.some((r) => r.kind === 'virtual' && r.supporting?.domain === 'beta.pt')).toBe(false)
    expect(rows.some((r) => r.kind === 'configured' && r.site?.id === 99)).toBe(true)
  })

  it('纯未拥有：notOwned=true 且 notAdded=false', () => {
    const rows = buildSiteRows({
      configured: [fakeSite({ id: 1, domain: 'alpha.pt' })],
      supporting,
      browserMap: buildBrowserCookieMap([]),
      expandNotOwned: true,
    })
    const gamma = rows.find((r) => r.supporting?.domain === 'gamma.pt')
    expect(gamma?.flags.notOwned).toBe(true)
    expect(gamma?.flags.notAdded).toBe(false)
    expect(gamma?.flags.browser).toBe(false)
  })
})
