import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  healthMp: vi.fn(),
  directDownloadToMp: vi.fn(),
}))

vi.mock('../core/mp-backend', () => ({
  healthMp: mocks.healthMp,
  directDownloadToMp: mocks.directDownloadToMp,
}))

import {
  directDownloadMagnet,
  directDownloadTorrentUrl,
  fetchTorrentBytes,
  isMediaRecognitionFailure,
  unwrapTorrentUrl,
} from '../services/direct-download'

describe('插件直接下载服务', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.healthMp.mockReset()
    mocks.directDownloadToMp.mockReset()
  })

  it('磁力链接直接提交到插件', async () => {
    mocks.directDownloadToMp.mockResolvedValue({ ok: true, downloadId: 'hash' })

    await expect(
      directDownloadMagnet(' magnet:?xt=urn:btih:0123456789012345678901234567890123456789 ', {
        downloader: 'qBittorrent',
        savePath: 'local:/downloads',
        labels: 'MOVIEPILOT',
      }),
    ).resolves.toEqual({ ok: true, downloadId: 'hash' })
    expect(mocks.directDownloadToMp).toHaveBeenCalledWith({
      type: 'magnet',
      content: 'magnet:?xt=urn:btih:0123456789012345678901234567890123456789',
      downloader: 'qBittorrent',
      save_path: 'local:/downloads',
      labels: 'MOVIEPILOT',
    })
  })

  it('种子链接按插件限制获取并上传 base64', async () => {
    mocks.healthMp.mockResolvedValue({
      ok: true,
      data: {
        enabled: true,
        capabilities: {
          direct_download: true,
          direct_download_types: ['torrent'],
          max_torrent_size: 32,
        },
      },
    })
    mocks.directDownloadToMp.mockResolvedValue({ ok: true, downloadId: 'torrent-hash' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([0x64, 0x31, 0x3a, 0x61, 0x65]), {
          status: 200,
          headers: { 'content-type': 'application/x-bittorrent' },
        }),
      ),
    )

    await expect(
      directDownloadTorrentUrl('https://tracker.example/download/1', {
        downloader: 'Transmission',
        savePath: 'local:/downloads',
      }),
    ).resolves.toEqual({ ok: true, downloadId: 'torrent-hash' })
    expect(mocks.directDownloadToMp).toHaveBeenCalledWith({
      type: 'torrent',
      content: 'ZDE6YWU=',
      downloader: 'Transmission',
      save_path: 'local:/downloads',
      labels: undefined,
    })
  })

  it('拒绝超过插件限制及明显非种子内容', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(new Response(new Uint8Array(20), { status: 200 }))
        .mockResolvedValueOnce(new Response(new TextEncoder().encode('<html>error</html>'), { status: 200 })),
    )

    await expect(fetchTorrentBytes('https://example.com/large.torrent', 10)).rejects.toThrow(
      '超过插件限制',
    )
    await expect(fetchTorrentBytes('https://example.com/error.torrent', 100)).rejects.toThrow(
      '不是有效的 torrent 文件',
    )
  })

  it('识别媒体失败信息并处理普通包装链接', () => {
    expect(isMediaRecognitionFailure('无法识别媒体信息')).toBe(true)
    expect(isMediaRecognitionFailure('下载器连接失败')).toBe(false)
    expect(unwrapTorrentUrl('https://example.com/a.torrent')).toBe('https://example.com/a.torrent')
    expect(unwrapTorrentUrl('[]https://example.com/a.torrent')).toBe('https://example.com/a.torrent')
  })
})
