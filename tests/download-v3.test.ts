import { beforeEach, describe, expect, it, vi } from 'vitest'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('../core/http', () => ({ api: { post } }))
import { addDownload } from '../services/download'

describe('v3 下载合同', () => {
  beforeEach(() => post.mockReset())
  const torrent = { title: 'Movie.2026', enclosure: 'https://pt.test/torrent/1' }

  it('来源身份使用 media_source + 字符串 media_id', async () => {
    post.mockResolvedValue({ ok: true, data: { download_id: 'hash' } })
    await expect(addDownload({ torrent_in: torrent, tmdbid: 550 })).resolves.toEqual({ ok: true })
    expect(post).toHaveBeenCalledWith('/api/v1/download/add', {
      torrent_in: torrent, media_source: 'themoviedb', media_id: '550',
    })
  })

  it('不能提交不完整媒体身份', async () => {
    expect((await addDownload({ torrent_in: torrent, media_source: 'douban' })).ok).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })

  it('识别失败返回确认标记，确认请求保留下载器和路径', async () => {
    post.mockResolvedValueOnce({ ok: false, error: '无法识别媒体信息', data: { success: false, data: { requires_confirmation: true } } })
      .mockResolvedValueOnce({ ok: true, data: { download_id: 'hash' } })
    expect((await addDownload({ torrent_in: torrent })).requiresConfirmation).toBe(true)
    const confirmed = { torrent_in: torrent, allow_unrecognized: true, downloader: 'qB', save_path: 'local:/downloads' }
    expect((await addDownload(confirmed)).ok).toBe(true)
    expect(post).toHaveBeenLastCalledWith('/api/v1/download/add', confirmed)
  })

  it('保留音乐实体和显式来源，不被来源专用字段覆盖', async () => {
    post.mockResolvedValue({ ok: true, data: {} })
    const payload = { torrent_in: torrent, media_source: 'musicbrainz', media_id: 'release-id', music_type: 'album' as const }
    await addDownload({ ...payload, tmdbid: 550 })
    expect(post).toHaveBeenCalledWith('/api/v1/download/add', payload)
  })
})
