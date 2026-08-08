import { describe, it, expect } from 'vitest'
import {
  parseIconLinksFromHtml,
  staticFaviconCandidates,
  publicFaviconServiceUrl,
  getCachedFaviconsBatch,
  setCachedFavicon,
  hydrateFaviconCache,
} from '../services/favicon-discover'

describe('parseIconLinksFromHtml', () => {
  it('解析 hashed favicon png 路径', () => {
    const html = `
      <html><head>
        <link rel="icon" type="image/png" href="/assets/favicon-xoiak6ee.png" />
        <link rel="apple-touch-icon" href="/assets/apple-touch.png" sizes="180x180" />
      </head></html>
    `
    const links = parseIconLinksFromHtml(html, 'https://pting.club/')
    expect(links[0]).toBe('https://pting.club/assets/favicon-xoiak6ee.png')
    expect(links).toContain('https://pting.club/assets/apple-touch.png')
  })

  it('href 在 rel 前也能解析', () => {
    const html = `<link href="/fav.svg" rel="icon" type="image/svg+xml">`
    const links = parseIconLinksFromHtml(html, 'https://example.com')
    expect(links[0]).toBe('https://example.com/fav.svg')
  })
})

describe('staticFaviconCandidates', () => {
  it('包含 ico/png 与 apex', () => {
    const list = staticFaviconCandidates('pt.pting.club')
    expect(list.some((u) => u.endsWith('/favicon.ico'))).toBe(true)
    expect(list.some((u) => u.endsWith('/favicon.png'))).toBe(true)
  })
})

describe('publicFaviconServiceUrl', () => {
  it('生成 favicon.im 地址（无协议前缀，仅主机名）', () => {
    const u = publicFaviconServiceUrl('pting.club')
    expect(u).toBe('https://a.favicon.im/pting.club')
    expect(u).not.toContain('http://pting')
    expect(u).not.toContain('https://pting')
  })
})

describe('getCachedFaviconsBatch', () => {
  it('批量读取内存缓存且不重复 hydrate 阻塞', async () => {
    await hydrateFaviconCache()
    await setCachedFavicon('a.example.com', 'https://a.example.com/favicon.ico')
    await setCachedFavicon('b.example.com', 'https://b.example.com/favicon.ico')
    const map = await getCachedFaviconsBatch(['a.example.com', 'b.example.com', 'miss.example.com'])
    expect(map['a.example.com']).toBe('https://a.example.com/favicon.ico')
    expect(map['b.example.com']).toBe('https://b.example.com/favicon.ico')
    expect(map['miss.example.com']).toBeUndefined()
  })
})
