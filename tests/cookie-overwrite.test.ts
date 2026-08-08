import { afterEach, describe, expect, it, vi } from 'vitest'
import { setDomainCookies } from '../utils/cookie'

function installCookieApi(initial: chrome.cookies.Cookie[] = []) {
  let cookies = [...initial]
  const remove = vi.fn(
    (
      details: chrome.cookies.Details,
      callback: (details: chrome.cookies.Details | null) => void,
    ) => {
      const url = new URL(details.url)
      const index = cookies.findIndex(
        (cookie) =>
          cookie.name === details.name &&
          cookie.storeId === (details.storeId || '0') &&
          cookie.domain.replace(/^\./, '') === url.hostname &&
          cookie.path === url.pathname,
      )
      if (index < 0) return callback(null)
      cookies.splice(index, 1)
      callback(details)
    },
  )
  const set = vi.fn(
    (
      details: chrome.cookies.SetDetails,
      callback: (cookie: chrome.cookies.Cookie | null) => void,
    ) => {
      const url = new URL(details.url)
      const cookie: chrome.cookies.Cookie = {
        domain: details.domain ? `.${details.domain.replace(/^\./, '')}` : url.hostname,
        expirationDate: details.expirationDate,
        hostOnly: !details.domain,
        httpOnly: details.httpOnly ?? false,
        name: details.name || '',
        path: details.path || url.pathname || '/',
        sameSite: details.sameSite || 'unspecified',
        secure: details.secure ?? false,
        session: details.expirationDate === undefined,
        storeId: details.storeId || '0',
        value: details.value || '',
      }
      cookies = cookies.filter(
        (item) =>
          !(
            item.name === cookie.name &&
            item.domain === cookie.domain &&
            item.path === cookie.path &&
            item.storeId === cookie.storeId
          ),
      )
      cookies.push(cookie)
      callback(cookie)
    },
  )
  const getAll = vi.fn(
    (
      details: chrome.cookies.GetAllDetails,
      callback: (cookies: chrome.cookies.Cookie[]) => void,
    ) => {
      const url = details.url ? new URL(details.url) : null
      const domain = details.domain?.replace(/^\./, '').toLowerCase()
      callback(
        cookies.filter((cookie) => {
          const cookieDomain = cookie.domain.replace(/^\./, '').toLowerCase()
          if (details.name && cookie.name !== details.name) return false
          if (domain && cookieDomain !== domain && !domain.endsWith(`.${cookieDomain}`)) return false
          if (url) {
            const host = url.hostname.toLowerCase()
            if (cookie.hostOnly ? cookieDomain !== host : host !== cookieDomain && !host.endsWith(`.${cookieDomain}`)) {
              return false
            }
            if (!url.pathname.startsWith(cookie.path)) return false
          }
          return true
        }),
      )
    },
  )

  vi.stubGlobal('chrome', {
    cookies: { getAll, remove, set },
    runtime: { lastError: undefined },
  })
  return { getAll, remove, set, current: () => [...cookies] }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('服务器 Cookie 覆盖浏览器', () => {
  it('删除旧 Domain Cookie 并写为可被站点退出删除的 host-only Cookie', async () => {
    const api = installCookieApi([
      {
        domain: '.pt.dxj.example-pt.test',
        expirationDate: 1786204418,
        hostOnly: false,
        httpOnly: false,
        name: 'c_secure_pass',
        path: '/',
        sameSite: 'unspecified',
        secure: true,
        session: false,
        storeId: '0',
        value: 'old',
      },
    ])

    const result = await setDomainCookies('https://pt.dxj.example-pt.test/', {
      c_secure_pass: 'server-value',
    })

    expect(result).toEqual({ ok: true, failed: [] })
    expect(api.remove).toHaveBeenCalledWith(
      {
        url: 'https://pt.dxj.example-pt.test/',
        name: 'c_secure_pass',
        storeId: '0',
      },
      expect.any(Function),
    )
    expect(api.set.mock.calls[0]?.[0]).not.toHaveProperty('domain')
    expect(api.current()).toEqual([
      expect.objectContaining({
        domain: 'pt.dxj.example-pt.test',
        hostOnly: true,
        name: 'c_secure_pass',
        path: '/',
        value: 'server-value',
      }),
    ])
  })

  it('保留无关 Cookie，并清理目标名称的不同路径变体', async () => {
    const base = {
      expirationDate: 1786204418,
      hostOnly: true,
      httpOnly: false,
      sameSite: 'unspecified' as const,
      secure: true,
      session: false,
      storeId: '0',
    }
    const api = installCookieApi([
      {
        ...base,
        domain: 'pt.dxj.example-pt.test',
        name: 'c_secure_pass',
        path: '/account',
        value: 'path-value',
      },
      {
        ...base,
        domain: 'pt.dxj.example-pt.test',
        name: 'theme',
        path: '/',
        value: 'dark',
      },
    ])

    const result = await setDomainCookies('https://pt.dxj.example-pt.test/', {
      c_secure_pass: 'new-value',
    })

    expect(result.ok).toBe(true)
    expect(api.current()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'theme', value: 'dark' }),
        expect.objectContaining({
          name: 'c_secure_pass',
          hostOnly: true,
          path: '/',
          value: 'new-value',
        }),
      ]),
    )
    expect(api.current().filter((cookie) => cookie.name === 'c_secure_pass')).toHaveLength(1)
  })
})
