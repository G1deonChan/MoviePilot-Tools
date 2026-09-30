import { beforeEach, describe, expect, it, vi } from 'vitest'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../core/http', () => ({ api: { get } }))
import { resolveSiteTorrent } from '../services/download'

const pageUrl = 'https://pt.test/torrents/876'
const other = { title: 'Other', enclosure: 'https://pt.test/download.php?id=1', page_url: 'https://pt.test/details.php?id=1' }
const target = { title: 'Movie', enclosure: 'https://pt.test/download.php?id=876', page_url: 'https://pt.test/details.php?id=876' }
const result = (items: unknown[]) => ({ ok: true, data: items })

describe('详情页种子定位', () => {
  beforeEach(() => get.mockReset())

  it('首页命中不发起搜索或额外翻页', async () => {
    get.mockResolvedValue(result([target]))
    expect((await resolveSiteTorrent(21, pageUrl, 'Audiences :: 种子详情 "Movie" - Powered by NexusPHP')).torrent).toEqual(target)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('首页未命中后按标题搜索，不能按标题误选其他编号', async () => {
    get.mockResolvedValueOnce(result([other])).mockResolvedValueOnce(result([other, target]))
    expect((await resolveSiteTorrent(21, pageUrl, 'Audiences :: 种子详情 "Movie" - Powered by NexusPHP')).torrent).toEqual(target)
    expect(get).toHaveBeenLastCalledWith('/api/v1/site/resource/21', { page: 0, keyword: 'Movie' })
  })

  it('搜索为空时继续浏览第二页，找到较早的种子', async () => {
    get.mockResolvedValueOnce(result([other])).mockResolvedValueOnce(result([])).mockResolvedValueOnce(result([target]))
    expect((await resolveSiteTorrent(21, pageUrl, 'Movie')).torrent).toEqual(target)
    expect(get).toHaveBeenLastCalledWith('/api/v1/site/resource/21', { page: 1 })
  })

  it('有限翻页后报告未匹配，不断言 Cookie 失效', async () => {
    get.mockResolvedValue(result([other]))
    const resolved = await resolveSiteTorrent(21, pageUrl, 'Movie')
    expect(resolved.ok).toBe(false)
    expect(resolved.message).toContain('编号匹配')
    expect(resolved.message).not.toContain('Cookie')
    expect(get).toHaveBeenCalledTimes(6)
  })

  it('接口失败保留服务端错误且不继续请求', async () => {
    get.mockResolvedValue({ ok: false, error: '站点连接失败' })
    expect(await resolveSiteTorrent(21, pageUrl, 'Movie')).toEqual({ ok: false, message: '站点连接失败' })
    expect(get).toHaveBeenCalledTimes(1)
  })
})
