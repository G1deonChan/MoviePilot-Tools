import { describe, expect, it } from 'vitest'
import type { AddTorrentIn, Site, SiteDomainAlias, SiteSupportingInfo } from '../core/types'
import { buildSiteTorrent, findConfiguredSiteForUrl, findTorrentForPage } from '../services/site-torrent'

const sites: Site[] = [
  {
    id: 21,
    name: '测试站点',
    domain: 'tracker.example.net',
    url: 'https://tracker.example.net/',
    cookie: 'uid=1; pass=secret',
    ua: 'Test-UA',
    downloader: 'qBittorrent',
    is_proxy: true,
    pri: 2,
  },
]

const supporting: Record<string, SiteSupportingInfo> = {
  'example.net': {
    id: 900,
    name: '测试站点',
    domain: 'example.net',
  },
  'example.org': {
    id: 900,
    name: '测试站点',
    domain: 'example.org',
  },
}

const aliases: SiteDomainAlias[] = [
  { siteId: '21', domain: 'backup.example.com' },
]

describe('PT 站种子下载匹配', () => {
  it('支持主域名、自定义备用域名和 supporting 同身份域名', () => {
    expect(findConfiguredSiteForUrl('https://tracker.example.net/details.php?id=1', sites, supporting, aliases)?.id).toBe(21)
    expect(findConfiguredSiteForUrl('https://backup.example.com/details.php?id=1', sites, supporting, aliases)?.id).toBe(21)
    expect(findConfiguredSiteForUrl('https://example.org/details.php?id=1', sites, supporting, aliases)?.id).toBe(21)
  })

  it('按完整详情页或种子 ID 匹配真实资源', () => {
    const resources: AddTorrentIn[] = [
      {
        title: 'Movie.2026.1080p',
        enclosure: 'https://example.org/download.php?id=876&passkey=x',
        page_url: 'https://example.org/details.php?id=876',
      },
    ]
    expect(findTorrentForPage('https://example.org/details.php?id=876', resources)?.title).toBe('Movie.2026.1080p')
    expect(findTorrentForPage('https://example.org/torrent/876', resources)?.enclosure).toContain('download.php')
  })

  it('构建下载参数时保留资源字段并补齐站点鉴权', () => {
    const torrent = buildSiteTorrent(
      {
        title: 'Movie.2026.1080p',
        enclosure: 'https://example.org/download.php?id=876',
        page_url: 'https://example.org/details.php?id=876',
        size: 1024,
        seeders: 8,
      },
      sites[0],
      'https://backup.example.com/details.php?id=876',
    )
    expect(torrent).toMatchObject({
      site: 21,
      site_name: '测试站点',
      site_cookie: 'uid=1; pass=secret',
      site_ua: 'Test-UA',
      site_proxy: true,
      site_order: 2,
      site_downloader: 'qBittorrent',
      size: 1024,
      seeders: 8,
    })
  })
})
